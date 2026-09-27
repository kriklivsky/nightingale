#!/usr/bin/env python3
"""Export Nightingale's exact UVR checkpoint as a static hybrid ONNX core."""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import json
from pathlib import Path

import numpy as np
import onnx
import torch
import yaml

from uvr_core import (
    AxialTransformerCore,
    BandSplitCore,
    MaskEstimatorCore,
    TransformerAxisCore,
)


EXPECTED_SOURCE_SHA256 = (
    "1de20d459332fe8869aeb01327a31df0032262706e1365114e852dc271779813"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stabilize_band_split_norms(model: onnx.ModelProto, expected_count: int) -> None:
    producers = {
        output: node
        for node in model.graph.node
        for output in node.output
    }
    repaired = 0
    patched_constants: set[str] = set()
    for node in model.graph.node:
        if node.op_type != "Clip" or len(node.input) < 2:
            continue
        cast = producers.get(node.input[1])
        if cast is None or cast.op_type != "Cast":
            continue
        constant = producers.get(cast.input[0])
        if constant is None or constant.op_type != "Constant":
            continue
        constant_name = constant.output[0]
        if constant_name in patched_constants:
            repaired += 1
            continue
        value = next((item for item in constant.attribute if item.name == "value"), None)
        if value is None:
            continue
        epsilon = onnx.numpy_helper.to_array(value.t)
        if epsilon.size != 1 or not np.isclose(
            float(epsilon), 1e-12, rtol=0.0, atol=1e-15
        ):
            continue
        value.t.CopyFrom(
            onnx.numpy_helper.from_array(np.asarray(1e-4, dtype=np.float32))
        )
        patched_constants.add(constant_name)
        repaired += 1

    if repaired != expected_count:
        raise ValueError(
            f"expected {expected_count} band-split normalizers, found {repaired}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--component",
        required=True,
        choices=(
            "band-split",
            "transformer-stack",
            "transformer-block",
            "time-transformer",
            "frequency-transformer",
            "mask",
        ),
    )
    parser.add_argument("--layer", type=int)
    parser.add_argument("--band-start", type=int)
    parser.add_argument("--band-stop", type=int)
    parser.add_argument("--opset", type=int, default=17)
    parser.add_argument("--skip-parity", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_sha = sha256(args.checkpoint)
    if source_sha != EXPECTED_SOURCE_SHA256:
        raise SystemExit(
            f"checkpoint SHA256 is {source_sha}, expected {EXPECTED_SOURCE_SHA256}"
        )

    from audio_separator.separator.roformer.roformer_loader import RoformerLoader

    config = yaml.load(args.config.read_text(encoding="utf-8"), Loader=yaml.FullLoader)
    loaded = RoformerLoader().load_model(str(args.checkpoint), config, "cpu")
    if not loaded.success:
        raise SystemExit(f"cannot load UVR checkpoint: {loaded.error_message}")
    model = loaded.model.eval()

    chunk_samples = int(config["model"]["stft_hop_length"]) * (
        int(config["inference"]["dim_t"]) - 1
    )
    time_frames = int(config["inference"]["dim_t"])
    input_width = sum(model.band_split.dim_inputs)
    output_width = model.num_stems * input_width
    input_shape = [1, time_frames, input_width]
    output_shape = [1, time_frames, output_width]
    frequency_bands = len(model.band_split.dim_inputs)
    dimension = int(model.layers[0][0].norm.gamma.numel())
    audio_channels = int(model.audio_channels)
    num_stems = int(model.num_stems)
    gathered_frequency_bins = int(model.freq_indices.numel())
    stft_kwargs = dict(model.stft_kwargs)
    freq_indices = model.freq_indices.cpu().tolist()
    num_bands_per_freq = model.num_bands_per_freq.cpu().tolist()
    component_details: dict[str, int | str] = {"name": args.component}
    if args.component == "band-split":
        core = BandSplitCore(model)
        component_input_shape = input_shape
        component_output_shape = [1, time_frames, frequency_bands, dimension]
    elif args.component in {
        "transformer-stack",
        "transformer-block",
        "time-transformer",
        "frequency-transformer",
    }:
        if args.component in {"time-transformer", "frequency-transformer"}:
            if args.layer is None:
                raise SystemExit(f"--layer is required for {args.component}")
            axis = "time" if args.component == "time-transformer" else "frequency"
            batch_size = 5 if axis == "time" else 89
            sequence_length = time_frames if axis == "time" else frequency_bands
            core = TransformerAxisCore(
                model, time_frames, args.layer, axis, batch_size
            )
            component_input_shape = [batch_size, sequence_length, dimension]
            component_output_shape = component_input_shape
            component_details["layer"] = args.layer
            component_details["axis"] = axis
            component_details["host_batch_size"] = batch_size
        else:
            if args.component == "transformer-block":
                if args.layer is None:
                    raise SystemExit("--layer is required for transformer-block")
                layer_start, layer_stop = args.layer, args.layer + 1
                component_details["layer"] = args.layer
            else:
                layer_start, layer_stop = 0, len(model.layers)
            core = AxialTransformerCore(model, time_frames, layer_start, layer_stop)
            component_input_shape = [1, time_frames, frequency_bands, dimension]
            component_output_shape = component_input_shape
            component_details["layer_start"] = layer_start
            component_details["layer_stop"] = layer_stop
            component_details["time_attention_batch_chunk"] = 5
            component_details["frequency_attention_batch_chunk"] = 89
    else:
        if args.band_start is None or args.band_stop is None:
            raise SystemExit("--band-start and --band-stop are required for mask")
        core = MaskEstimatorCore(model, args.band_start, args.band_stop)
        component_input_shape = [
            1,
            time_frames,
            args.band_stop - args.band_start,
            dimension,
        ]
        component_output_shape = [
            1,
            time_frames,
            sum(model.band_split.dim_inputs[args.band_start : args.band_stop]),
        ]
        component_details["band_start"] = args.band_start
        component_details["band_stop"] = args.band_stop

    core = core.eval()
    sample = torch.zeros(component_input_shape, dtype=torch.float32)
    del model, loaded
    gc.collect()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    reference = None
    if not args.skip_parity:
        with torch.inference_mode():
            reference = core(sample)
        if list(reference.shape) != component_output_shape:
            raise SystemExit(f"unexpected core output shape: {list(reference.shape)}")

    torch.onnx.export(
        core,
        sample,
        str(args.output),
        input_names=["input"],
        output_names=["output"],
        opset_version=args.opset,
        do_constant_folding=False,
        dynamic_axes=None,
    )
    onnx_model = onnx.load(str(args.output), load_external_data=True)
    if args.component == "band-split":
        stabilize_band_split_norms(onnx_model, frequency_bands)
        onnx.save(onnx_model, str(args.output))
    onnx.checker.check_model(onnx_model)

    if not args.skip_parity:
        import onnxruntime as ort

        session = ort.InferenceSession(
            str(args.output), providers=["CPUExecutionProvider"]
        )
        actual = session.run(None, {"input": sample.numpy()})[0]
        assert reference is not None
        expected = reference.numpy()
        error = np.abs(expected - actual)
        print(
            f"PyTorch/ONNX parity: MAE={error.mean():.9g} "
            f"max_abs={error.max():.9g}"
        )

    metadata = {
        "format_version": 1,
        "model_family": "mel_band_roformer",
        "source_model": args.checkpoint.name,
        "source_sha256": source_sha,
        "source_config": args.config.name,
        "source_config_sha256": sha256(args.config),
        "audio_separator_version": importlib.metadata.version("audio-separator"),
        "opset": args.opset,
        "target": "rk3588",
        "precision": "fp16",
        "chunk_samples": chunk_samples,
        "overlap": int(config["inference"]["num_overlap"]),
        "sample_rate": int(config["audio"]["sample_rate"]),
        "audio_channels": audio_channels,
        "num_stems": num_stems,
        "gathered_frequency_bins": gathered_frequency_bins,
        "core_input_shape": input_shape,
        "core_output_shape": output_shape,
        "core_dtype": "float32",
        "core_layout": "BTF",
        "component": component_details,
        "component_input_shape": component_input_shape,
        "component_output_shape": component_output_shape,
        "stft": {
            "n_fft": int(stft_kwargs["n_fft"]),
            "hop_length": int(stft_kwargs["hop_length"]),
            "win_length": int(stft_kwargs["win_length"]),
            "normalized": bool(stft_kwargs["normalized"]),
            "window": "hann",
            "center": True,
        },
        "freq_indices": freq_indices,
        "num_bands_per_freq": num_bands_per_freq,
        "audio_separator_config": config,
        "onnx_file": args.output.name,
        "onnx_sha256": sha256(args.output),
    }
    metadata_path = Path(f"{args.output}.json")
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    print(f"source model: {args.checkpoint}")
    print(f"source SHA256: {source_sha}")
    print(f"audio-separator: {metadata['audio_separator_version']}")
    print(f"opset: {args.opset}")
    print(f"component: {component_details}")
    print(f"input: float32 {component_input_shape}")
    print(f"output: float32 {component_output_shape}")
    print(f"ONNX: {args.output}")
    print(f"ONNX SHA256: {metadata['onnx_sha256']}")
    print(f"metadata: {metadata_path}")


if __name__ == "__main__":
    main()
