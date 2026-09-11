#!/usr/bin/env python3
"""Export the memory-bounded ONNX component set for the Nightingale UVR model."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--exporter",
        type=Path,
        default=Path(__file__).with_name("export_uvr_onnx.py"),
    )
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def expected_component(component_args: list[str]) -> dict[str, Any]:
    component = component_args[component_args.index("--component") + 1]
    expected: dict[str, Any] = {"name": component}
    if "--layer" in component_args:
        expected["layer"] = int(component_args[component_args.index("--layer") + 1])
        expected["axis"] = "time" if component == "time-transformer" else "frequency"
        expected["host_batch_size"] = 5 if expected["axis"] == "time" else 89
    if "--band-start" in component_args:
        expected["band_start"] = int(
            component_args[component_args.index("--band-start") + 1]
        )
        expected["band_stop"] = int(
            component_args[component_args.index("--band-stop") + 1]
        )
    return expected


def can_reuse(
    output: Path,
    metadata_path: Path,
    source_sha: str,
    config_sha: str,
    component_args: list[str],
) -> bool:
    if not output.is_file() or not metadata_path.is_file():
        return False
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        return (
            metadata.get("source_sha256") == source_sha
            and metadata.get("source_config_sha256") == config_sha
            and metadata.get("onnx_sha256") == sha256(output)
            and metadata.get("component") == expected_component(component_args)
        )
    except (OSError, ValueError):
        return False


def component_commands() -> list[tuple[str, list[str]]]:
    commands: list[tuple[str, list[str]]] = [("band-split", ["--component", "band-split"])]
    for layer in range(6):
        commands.append(
            (
                f"transformer-{layer:02d}-time",
                ["--component", "time-transformer", "--layer", str(layer)],
            )
        )
        commands.append(
            (
                f"transformer-{layer:02d}-frequency",
                ["--component", "frequency-transformer", "--layer", str(layer)],
            )
        )
    for start in range(0, 60, 10):
        stop = start + 10
        commands.append(
            (
                f"mask-{start:02d}-{stop:02d}",
                [
                    "--component",
                    "mask",
                    "--band-start",
                    str(start),
                    "--band-stop",
                    str(stop),
                ],
            )
        )
    return commands


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    source_sha = sha256(args.checkpoint)
    config_sha = sha256(args.config)
    for name, component_args in component_commands():
        output = args.output_dir / f"{name}.onnx"
        metadata = Path(f"{output}.json")
        if not args.force and can_reuse(
            output, metadata, source_sha, config_sha, component_args
        ):
            print(f"reuse {output}", flush=True)
            continue
        log_path = args.output_dir / f"{name}.export.log"
        command = [
            sys.executable,
            str(args.exporter),
            "--checkpoint",
            str(args.checkpoint),
            "--config",
            str(args.config),
            "--output",
            str(output),
            "--skip-parity",
            *component_args,
        ]
        print(f"export {name}", flush=True)
        with log_path.open("w", encoding="utf-8") as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        if result.returncode != 0:
            raise SystemExit(f"export failed ({result.returncode}); inspect {log_path}")


if __name__ == "__main__":
    main()
