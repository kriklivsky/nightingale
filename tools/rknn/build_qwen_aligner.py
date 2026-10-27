#!/usr/bin/env python3
"""Convert Qwen3-ForcedAligner ONNX components to RK3588 RKNN FP16 and write the bundle manifest."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import subprocess
import sys
from pathlib import Path

BUNDLE_FORMAT = "nightingale-qwen-aligner-rknn-v1"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def convert(onnx: Path, record: dict, output: Path) -> None:
    from rknn.api import RKNN

    rknn = RKNN(verbose=False)
    try:
        if rknn.config(target_platform="rk3588", optimization_level=3) != 0:
            raise SystemExit("rknn.config failed")
        names = list(record["inputs"])
        shapes = [record["inputs"][name] for name in names]
        if rknn.load_onnx(model=str(onnx), inputs=names, input_size_list=shapes) != 0:
            raise SystemExit("rknn.load_onnx failed")
        if rknn.build(do_quantization=False) != 0:
            raise SystemExit("rknn.build failed")
        if rknn.export_rknn(str(output)) != 0:
            raise SystemExit("rknn.export_rknn failed")
    finally:
        rknn.release()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onnx-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--component")
    args = parser.parse_args()

    source = json.loads((args.onnx_dir / "onnx-manifest.json").read_text(encoding="utf-8"))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.component is not None:
        record = next(item for item in source["components"] if item["name"] == args.component)
        onnx = args.onnx_dir / record["onnx"]
        if sha256(onnx) != record["onnx_sha256"]:
            raise SystemExit(f"{onnx} does not match its export record")
        convert(onnx, record, args.output_dir / f"{record['name']}.rknn")
        return

    components = []
    for record in source["components"]:
        output = args.output_dir / f"{record['name']}.rknn"
        log = args.output_dir / f"{record['name']}.convert.log"
        print(f"convert {record['name']}", flush=True)
        command = [
            sys.executable, __file__, "--onnx-dir", str(args.onnx_dir),
            "--output-dir", str(args.output_dir), "--component", record["name"],
        ]
        with log.open("w", encoding="utf-8") as handle:
            if subprocess.run(command, stdout=handle, stderr=subprocess.STDOUT).returncode != 0:
                raise SystemExit(f"conversion of {record['name']} failed; inspect {log}")
        components.append({**record, "file": output.name, "sha256": sha256(output)})

    manifest = {
        **{key: value for key, value in source.items() if key != "components"},
        "bundle_format": BUNDLE_FORMAT,
        "target": "rk3588",
        "precision": "fp16",
        "rknn_toolkit_version": importlib.metadata.version("rknn-toolkit2"),
        "components": components,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"manifest: {args.output_dir / 'manifest.json'}", flush=True)


if __name__ == "__main__":
    main()
