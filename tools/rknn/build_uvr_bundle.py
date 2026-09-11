#!/usr/bin/env python3
"""Convert split UVR ONNX components and create a deployable RKNN manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


TRANSFORMER_LAYERS = 6
MASK_RANGES = tuple((start, start + 10) for start in range(0, 60, 10))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onnx-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--converter",
        type=Path,
        default=Path(__file__).with_name("convert_uvr.py"),
    )
    return parser.parse_args()


def component_names() -> list[str]:
    names = ["band-split"]
    for layer in range(TRANSFORMER_LAYERS):
        names.append(f"transformer-{layer:02d}-time")
        names.append(f"transformer-{layer:02d}-frequency")
    names.extend(f"mask-{start:02d}-{stop:02d}" for start, stop in MASK_RANGES)
    return names


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def component_record(metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        **metadata["component"],
        "source_onnx": metadata["onnx_file"],
        "source_onnx_sha256": metadata["onnx_sha256"],
        "file": metadata["rknn_file"],
        "sha256": metadata["rknn_sha256"],
        "input_shape": metadata["component_input_shape"],
        "output_shape": metadata["component_output_shape"],
    }


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    metadata_items: list[dict[str, Any]] = []

    for name in component_names():
        onnx_path = args.onnx_dir / f"{name}.onnx"
        onnx_metadata_path = Path(f"{onnx_path}.json")
        output_path = args.output_dir / f"{name}.rknn"
        output_metadata_path = Path(f"{output_path}.json")
        if not onnx_path.is_file() or not onnx_metadata_path.is_file():
            raise SystemExit(f"missing ONNX component or metadata: {onnx_path}")

        onnx_metadata = load_json(onnx_metadata_path)
        reusable = False
        if output_path.is_file() and output_metadata_path.is_file():
            output_metadata = load_json(output_metadata_path)
            reusable = (
                output_metadata.get("onnx_sha256") == onnx_metadata["onnx_sha256"]
                and output_metadata.get("rknn_sha256") == sha256(output_path)
            )
        if reusable:
            print(f"reuse {output_path}", flush=True)
        else:
            log_path = args.output_dir / f"{name}.convert.log"
            command = [
                sys.executable,
                str(args.converter),
                "--onnx",
                str(onnx_path),
                "--output",
                str(output_path),
            ]
            print(f"convert {onnx_path} -> {output_path}", flush=True)
            with log_path.open("w", encoding="utf-8") as log:
                result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode != 0:
                raise SystemExit(
                    f"conversion failed ({result.returncode}); inspect {log_path}"
                )
        metadata_items.append(load_json(output_metadata_path))

    reference = metadata_items[0]
    common_keys = (
        "format_version",
        "model_family",
        "source_sha256",
        "source_config_sha256",
        "target",
        "precision",
        "chunk_samples",
        "overlap",
        "sample_rate",
        "audio_channels",
        "num_stems",
        "gathered_frequency_bins",
        "core_input_shape",
        "core_output_shape",
        "core_dtype",
        "core_layout",
        "stft",
        "freq_indices",
        "num_bands_per_freq",
    )
    for metadata in metadata_items[1:]:
        for key in common_keys:
            if metadata[key] != reference[key]:
                raise SystemExit(f"component metadata mismatch for {key}")

    manifest = {key: reference[key] for key in common_keys}
    manifest.update(
        {
            "bundle_format": "nightingale-split-rknn-v1",
            "source_model": reference["source_model"],
            "source_config": reference["source_config"],
            "audio_separator_version": reference["audio_separator_version"],
            "rknn_toolkit_version": reference["rknn_toolkit_version"],
            "audio_separator_config": reference["audio_separator_config"],
            "components": [component_record(item) for item in metadata_items],
        }
    )
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"manifest: {manifest_path}", flush=True)


if __name__ == "__main__":
    main()
