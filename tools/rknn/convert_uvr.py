#!/usr/bin/env python3
"""Convert the exported Nightingale UVR ONNX core to RK3588 RKNN FP16."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onnx", required=True, type=Path)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    metadata_path = args.metadata or Path(f"{args.onnx}.json")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    actual_onnx_sha = sha256(args.onnx)
    if actual_onnx_sha != metadata.get("onnx_sha256"):
        raise SystemExit("ONNX checksum does not match its metadata")

    from rknn.api import RKNN

    toolkit_version = importlib.metadata.version("rknn-toolkit2")
    rknn = RKNN(verbose=args.verbose)
    try:
        ret = rknn.config(
            target_platform="rk3588",
            optimization_level=3,
            compress_weight=True,
        )
        if ret != 0:
            raise SystemExit(f"rknn.config failed: {ret}")
        ret = rknn.load_onnx(
            model=str(args.onnx),
            inputs=["input"],
            input_size_list=[metadata["component_input_shape"]],
        )
        if ret != 0:
            raise SystemExit(f"rknn.load_onnx failed: {ret}")
        ret = rknn.build(do_quantization=False)
        if ret != 0:
            raise SystemExit(f"rknn.build failed: {ret}")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        ret = rknn.export_rknn(str(args.output))
        if ret != 0:
            raise SystemExit(f"rknn.export_rknn failed: {ret}")
    finally:
        rknn.release()

    metadata.update(
        {
            "rknn_toolkit_version": toolkit_version,
            "rknn_file": args.output.name,
            "rknn_sha256": sha256(args.output),
        }
    )
    output_metadata = Path(f"{args.output}.json")
    output_metadata.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"source model: {metadata['source_model']}")
    print(f"source SHA256: {metadata['source_sha256']}")
    print(f"ONNX: {args.onnx}")
    print(f"ONNX SHA256: {actual_onnx_sha}")
    print(f"RKNN Toolkit: {toolkit_version}")
    print("target: rk3588")
    print("precision: fp16")
    print(f"component: {metadata['component']}")
    print(f"input: {metadata['core_dtype']} {metadata['component_input_shape']}")
    print(f"output: {metadata['core_dtype']} {metadata['component_output_shape']}")
    print(f"RKNN: {args.output}")
    print(f"RKNN SHA256: {metadata['rknn_sha256']}")
    print(f"metadata: {output_metadata}")


if __name__ == "__main__":
    main()
