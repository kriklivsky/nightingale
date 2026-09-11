#!/usr/bin/env python3
"""Headless hardware validation for Nightingale's RK3588 UVR backend."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import resource
import sys
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch


class HardwareMonitor:
    """Sample Rockchip debugfs and thermal data without external tools."""

    def __init__(self, interval: float = 0.05):
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.samples = 0
        self.nonzero_samples = 0
        self.npu_max_percent = [0, 0, 0]
        self.max_temp_c: float | None = None

    def __enter__(self) -> HardwareMonitor:
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join()

    def _run(self) -> None:
        while not self.stop_event.wait(self.interval):
            try:
                text = Path("/sys/kernel/debug/rknpu/load").read_text(encoding="utf-8")
                values = [int(value) for value in re.findall(r"Core\d+:\s*(\d+)%", text)]
                if len(values) == 3:
                    self.samples += 1
                    self.nonzero_samples += int(any(values))
                    self.npu_max_percent = [
                        max(previous, current)
                        for previous, current in zip(self.npu_max_percent, values)
                    ]
            except (OSError, ValueError, IndexError):
                pass
            for path in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
                try:
                    temperature = int(path.read_text(encoding="utf-8").strip()) / 1000
                    self.max_temp_c = max(self.max_temp_c or temperature, temperature)
                except (OSError, ValueError):
                    pass

    def result(self) -> dict[str, Any]:
        return {
            "samples": self.samples,
            "nonzero_samples": self.nonzero_samples,
            "npu_max_percent": self.npu_max_percent,
            "max_temp_c": self.max_temp_c,
        }


def parse_args() -> argparse.Namespace:
    repository = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument(
        "--analyzer-dir",
        type=Path,
        default=repository / "app-core" / "analyzer",
    )
    parser.add_argument("--input-wav", type=Path)
    parser.add_argument("--reference-npy", type=Path)
    parser.add_argument("--output-npy", type=Path)
    parser.add_argument("--iterations", type=int, default=1)
    parser.add_argument(
        "--core",
        choices=("all", "0", "1", "2", "0_1", "0_1_2"),
        default="all",
    )
    return parser.parse_args()


def deterministic_audio(sample_rate: int, samples: int) -> torch.Tensor:
    timeline = torch.arange(samples, dtype=torch.float32) / sample_rate
    envelope = 0.55 + 0.45 * torch.sin(2 * torch.pi * 1.7 * timeline)
    left = 0.12 * envelope * torch.sin(2 * torch.pi * 220.0 * timeline)
    left += 0.035 * torch.sin(2 * torch.pi * 880.0 * timeline)
    right = 0.11 * envelope * torch.sin(2 * torch.pi * 223.0 * timeline + 0.2)
    right += 0.03 * torch.sin(2 * torch.pi * 659.25 * timeline)
    return torch.stack((left, right)).unsqueeze(0).contiguous()


def load_audio(path: Path, sample_rate: int, max_samples: int) -> torch.Tensor:
    import soundfile as sf

    audio, actual_rate = sf.read(path, dtype="float32", always_2d=True)
    if actual_rate != sample_rate:
        raise SystemExit(f"input sample rate is {actual_rate}, expected {sample_rate}")
    if audio.shape[1] != 2:
        raise SystemExit(f"input has {audio.shape[1]} channels, expected stereo")
    if not audio.shape[0]:
        raise SystemExit("input WAV is empty")
    audio = audio[:max_samples]
    return torch.from_numpy(np.ascontiguousarray(audio.T[None]))


def output_statistics(array: np.ndarray, sample_rate: int) -> dict[str, Any]:
    return {
        "shape": list(array.shape),
        "duration_s": array.shape[-1] / sample_rate,
        "sample_rate": sample_rate,
        "channels": array.shape[-2],
        "finite": bool(np.isfinite(array).all()),
        "rms": float(np.sqrt(np.mean(array.astype(np.float64) ** 2))),
        "peak": float(np.max(np.abs(array))),
        "clipped_samples": int(np.count_nonzero(np.abs(array) >= 1.0)),
    }


def parity_metrics(reference: np.ndarray, actual: np.ndarray) -> dict[str, Any]:
    if reference.shape != actual.shape:
        raise SystemExit(
            f"reference shape is {reference.shape}, RKNN output is {actual.shape}"
        )
    expected = reference.astype(np.float64, copy=False)
    observed = actual.astype(np.float64, copy=False)
    error = observed - expected
    expected_energy = float(np.sum(expected * expected))
    error_energy = float(np.sum(error * error))
    denominator = float(np.linalg.norm(expected) * np.linalg.norm(observed))
    from scipy.signal import correlate, correlation_lags

    correlation = correlate(expected[0, 0], observed[0, 0], mode="full", method="fft")
    lags = correlation_lags(expected.shape[-1], observed.shape[-1], mode="full")
    return {
        "mae": float(np.mean(np.abs(error))),
        "mse": float(np.mean(error * error)),
        "max_abs_error": float(np.max(np.abs(error))),
        "cosine_similarity": float(
            np.vdot(expected.ravel(), observed.ravel()) / max(denominator, 1e-30)
        ),
        "snr_db": float(
            10 * math.log10(max(expected_energy, 1e-30) / max(error_energy, 1e-30))
        ),
        "sync_lag_samples": int(lags[np.argmax(correlation)]),
    }


def main() -> None:
    args = parse_args()
    if args.iterations < 1:
        raise SystemExit("--iterations must be at least one")
    metadata = json.loads(args.manifest.read_text(encoding="utf-8"))
    sample_rate = int(metadata["sample_rate"])
    chunk_samples = int(metadata["chunk_samples"])
    audio = (
        load_audio(args.input_wav, sample_rate, chunk_samples)
        if args.input_wav
        else deterministic_audio(sample_rate, chunk_samples)
    )

    sys.path.insert(0, str(args.analyzer_dir.resolve()))
    os.environ["NIGHTINGALE_RKNN_CORE"] = args.core
    from uvr_backend import RknnUvrBackend

    init_start = time.perf_counter()
    backend = RknnUvrBackend(args.manifest)
    init_s = time.perf_counter() - init_start
    results: dict[str, Any] = {
        "manifest": str(args.manifest),
        "core": args.core,
        "context_count": len(backend._runtimes),
        "init_s": init_s,
        "iterations": [],
    }
    try:
        output_array = None
        for number in range(1, args.iterations + 1):
            cpu_start = time.process_time()
            wall_start = time.perf_counter()
            with HardwareMonitor() as monitor:
                output = backend.infer(audio)
            wall_s = time.perf_counter() - wall_start
            cpu_s = time.process_time() - cpu_start
            output_array = output.detach().cpu().numpy()
            results["iterations"].append(
                {
                    "number": number,
                    "wall_s": wall_s,
                    "cpu_s": cpu_s,
                    "cpu_percent": 100 * cpu_s / wall_s,
                    "profile": backend.last_profile,
                    "hardware": monitor.result(),
                    "output": output_statistics(output_array, sample_rate),
                    "peak_rss_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                    / 1024,
                }
            )
        assert output_array is not None
        if args.reference_npy:
            results["parity"] = parity_metrics(np.load(args.reference_npy), output_array)
        if args.output_npy:
            np.save(args.output_npy, output_array)
            results["output_npy"] = str(args.output_npy)
    finally:
        backend.close()
    print(json.dumps(results, indent=2), flush=True)


if __name__ == "__main__":
    main()
