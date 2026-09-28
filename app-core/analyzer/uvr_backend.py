"""Inference backends for the Nightingale UVR karaoke model.

The existing ``audio-separator`` implementation owns audio decoding,
normalisation, chunking, overlap-add and output handling.  This module swaps
only the per-chunk MelBand-Roformer model call when RKNN is selected.
"""

from __future__ import annotations

import atexit
import ctypes.util
import hashlib
import json
import os
import platform
import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Any, Iterator

import numpy as np
import torch


RKNN_BUNDLE_NAME = (
    "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956."
    "rk3588.fp16"
)
RKNN_METADATA_VERSION = 1
RKNN_BUNDLE_FORMAT = "nightingale-split-rknn-v1"
SUPPORTED_SOURCE_SHA256 = (
    "1de20d459332fe8869aeb01327a31df0032262706e1365114e852dc271779813"
)
EXPECTED_MODEL_METADATA = {
    "model_family": "mel_band_roformer",
    "precision": "fp16",
    "chunk_samples": 352800,
    "overlap": 4,
    "sample_rate": 44100,
    "audio_channels": 2,
    "num_stems": 1,
    "gathered_frequency_bins": 3958,
    "core_input_shape": [1, 801, 7916],
    "core_output_shape": [1, 801, 7916],
    "core_dtype": "float32",
    "core_layout": "BTF",
}
EXPECTED_STFT_METADATA = {
    "n_fft": 2048,
    "hop_length": 441,
    "win_length": 2048,
    "normalized": False,
    "window": "hann",
    "center": True,
}


class UvrBackendError(RuntimeError):
    """Raised when a requested UVR inference backend cannot be used."""


class UvrInferenceBackend(ABC):
    """A per-chunk UVR model inference backend."""

    name: str

    @abstractmethod
    def infer(self, tensor: torch.Tensor) -> torch.Tensor:
        """Infer a stem waveform from ``[batch, channels, samples]`` input."""

    def close(self) -> None:
        """Release backend resources."""


class ExistingUvrBackend(UvrInferenceBackend):
    """Thin adapter around the existing PyTorch RoFormer model."""

    name = "onnx/existing"

    def __init__(self, model: torch.nn.Module):
        self._model = model

    def infer(self, tensor: torch.Tensor) -> torch.Tensor:
        with torch.inference_mode():
            return self._model(tensor)


def _read_compatible() -> str:
    try:
        return Path("/proc/device-tree/compatible").read_bytes().replace(b"\0", b",").decode()
    except (OSError, UnicodeError):
        return ""


def _rknn_device_available() -> bool:
    return any(
        path.exists()
        for path in (
            Path("/dev/dri/by-path/platform-fdab0000.npu-render"),
            Path("/sys/kernel/debug/rknpu/version"),
            Path("/dev/rknpu0"),
        )
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def resolve_rknn_model(models_dir: str) -> Path:
    override = os.environ.get("NIGHTINGALE_UVR_RKNN_MODEL")
    bundle = (
        Path(override).expanduser()
        if override
        else Path(models_dir) / RKNN_BUNDLE_NAME
    )
    return bundle / "manifest.json" if bundle.is_dir() or not bundle.suffix else bundle


def _validate_metadata(metadata_path: Path) -> dict[str, Any]:
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise UvrBackendError(f"cannot read RKNN metadata {metadata_path}: {exc}") from exc

    if metadata.get("format_version") != RKNN_METADATA_VERSION:
        raise UvrBackendError(
            f"unsupported RKNN metadata version {metadata.get('format_version')!r}"
        )
    if metadata.get("target") != "rk3588":
        raise UvrBackendError(f"RKNN model target is {metadata.get('target')!r}, not 'rk3588'")
    if metadata.get("source_sha256") != SUPPORTED_SOURCE_SHA256:
        raise UvrBackendError("RKNN model was not built from Nightingale's supported UVR checkpoint")
    if metadata.get("bundle_format") != RKNN_BUNDLE_FORMAT:
        raise UvrBackendError(f"unsupported RKNN bundle format {metadata.get('bundle_format')!r}")
    for key, expected in EXPECTED_MODEL_METADATA.items():
        if metadata.get(key) != expected:
            raise UvrBackendError(
                f"incompatible RKNN metadata {key}: "
                f"expected {expected!r}, got {metadata.get(key)!r}"
            )
    if metadata.get("stft") != EXPECTED_STFT_METADATA:
        raise UvrBackendError("incompatible RKNN STFT metadata")
    if not isinstance(metadata.get("audio_separator_config"), dict):
        raise UvrBackendError("RKNN bundle is missing the audio-separator config")
    if not isinstance(metadata.get("freq_indices"), list) or len(metadata["freq_indices"]) != 3958:
        raise UvrBackendError("RKNN bundle has incompatible frequency indices")
    if not isinstance(metadata.get("num_bands_per_freq"), list) or len(
        metadata["num_bands_per_freq"]
    ) != 1025:
        raise UvrBackendError("RKNN bundle has incompatible mel-band counts")
    components = metadata.get("components")
    if not isinstance(components, list) or len(components) != 19:
        raise UvrBackendError("RKNN bundle must contain exactly 19 components")
    expected_names = ["band-split"]
    for layer in range(6):
        expected_names.append(f"transformer-{layer:02d}-time")
        expected_names.append(f"transformer-{layer:02d}-frequency")
    expected_names.extend(f"mask-{start:02d}-{start + 10:02d}" for start in range(0, 60, 10))
    mask_widths = [244, 276, 508, 1008, 1980, 3900]
    expected_shapes = [([1, 801, 7916], [1, 801, 60, 384])]
    for _layer in range(6):
        expected_shapes.extend(
            [([5, 801, 384], [5, 801, 384]), ([89, 60, 384], [89, 60, 384])]
        )
    expected_shapes.extend(
        ([1, 801, 10, 384], [1, 801, width]) for width in mask_widths
    )
    for expected_name, expected_shape, component in zip(
        expected_names, expected_shapes, components
    ):
        filename = component.get("file") if isinstance(component, dict) else None
        if not isinstance(filename, str) or Path(filename).name != filename:
            raise UvrBackendError(f"invalid RKNN component filename {filename!r}")
        if Path(filename).stem != expected_name:
            raise UvrBackendError(
                f"RKNN component order mismatch: expected {expected_name}, got {filename}"
            )
        if (component.get("input_shape"), component.get("output_shape")) != expected_shape:
            raise UvrBackendError(f"incompatible RKNN component shapes: {filename}")
        model_path = metadata_path.parent / filename
        expected_model_sha = component.get("sha256")
        if not model_path.is_file():
            raise UvrBackendError(f"RKNN component is missing: {model_path}")
        if not isinstance(expected_model_sha, str) or _sha256(model_path) != expected_model_sha:
            raise UvrBackendError(f"RKNN model checksum mismatch: {model_path}")
    return metadata


def _rknn_readiness(models_dir: str) -> tuple[bool, str]:
    if platform.machine().lower() not in {"aarch64", "arm64"}:
        return False, f"architecture is {platform.machine()}, not aarch64"
    compatible = _read_compatible().lower()
    if "rk3588" not in compatible:
        return False, f"device-tree is not RK3588 ({compatible or 'unavailable'})"
    if not _rknn_device_available():
        return False, "Rockchip NPU device is unavailable"
    if ctypes.util.find_library("rknnrt") is None:
        return False, "librknnrt is unavailable"
    metadata = resolve_rknn_model(models_dir)
    if not metadata.is_file():
        return False, f"RKNN bundle manifest is missing ({metadata})"
    try:
        _validate_metadata(metadata)
        from rknnlite.api import RKNNLite  # noqa: F401
    except (ImportError, UvrBackendError) as exc:
        return False, str(exc)
    return True, "ready"


def select_uvr_backend(models_dir: str) -> str:
    """Resolve ``auto``, ``rknn`` or the existing backend.

    Explicit RKNN selection never falls back silently.  ``onnx`` and
    ``existing`` are aliases because audio-separator may use PyTorch or ONNX
    internally depending on the selected UVR model family.
    """

    requested = os.environ.get("NIGHTINGALE_UVR_BACKEND", "auto").strip().lower()
    if requested not in {"auto", "rknn", "onnx", "existing"}:
        raise UvrBackendError(
            "NIGHTINGALE_UVR_BACKEND must be auto, rknn, onnx, or existing"
        )
    if requested in {"onnx", "existing"}:
        print("[nightingale:LOG] UVR backend: existing", flush=True)
        return "existing"

    ready, reason = _rknn_readiness(models_dir)
    if ready:
        print("[nightingale:LOG] SoC: RK3588/RK3588S", flush=True)
        print("[nightingale:LOG] NPU: available", flush=True)
        print("[nightingale:LOG] UVR backend: RKNN", flush=True)
        return "rknn"
    if requested == "rknn":
        raise UvrBackendError(f"RKNN backend requested but unavailable: {reason}")
    print(f"[nightingale:LOG] UVR backend: existing (RKNN auto unavailable: {reason})", flush=True)
    return "existing"


def _rotate_mask_layout(flat_masks: np.ndarray, metadata: dict[str, Any]) -> torch.Tensor:
    batch, frames, packed = flat_masks.shape
    num_stems = int(metadata["num_stems"])
    freq_bins = int(metadata["gathered_frequency_bins"])
    expected = num_stems * freq_bins * 2
    if packed != expected:
        raise UvrBackendError(
            f"RKNN output width mismatch: got {packed}, expected {expected}"
        )
    masks = flat_masks.reshape(batch, frames, num_stems, freq_bins, 2)
    return torch.from_numpy(np.ascontiguousarray(masks.transpose(0, 2, 3, 1, 4)))


class RknnUvrBackend(UvrInferenceBackend):
    """Hybrid CPU STFT/ISTFT + RK3588 NPU MelBand-Roformer core."""

    name = "rknn"

    def __init__(self, metadata_path: Path):
        self.model_path = metadata_path
        self.metadata = _validate_metadata(metadata_path)
        self._runtimes: list[tuple[dict[str, Any], Any]] = []
        self._stream_components = (
            os.environ.get("NIGHTINGALE_RKNN_STREAM_COMPONENTS", "").strip() == "1"
        )
        self._parallel_cores = (
            os.environ.get("NIGHTINGALE_RKNN_PARALLEL_CORES", "").strip() == "1"
        )
        if self._parallel_cores and not self._stream_components:
            raise UvrBackendError("parallel RKNN cores require streamed components")
        self._closed = False
        self.last_profile: dict[str, float] | None = None
        self._initialise_runtimes()

        self.freq_indices = torch.tensor(self.metadata["freq_indices"], dtype=torch.long)
        self.num_bands_per_freq = torch.tensor(
            self.metadata["num_bands_per_freq"], dtype=torch.float32
        )
        self.audio_channels = int(self.metadata["audio_channels"])
        self.num_stems = int(self.metadata["num_stems"])
        self.stft_kwargs = {
            key: self.metadata["stft"][key]
            for key in ("n_fft", "hop_length", "win_length", "normalized")
        }
        self.stft_window = torch.hann_window(self.stft_kwargs["win_length"])

    def _load_runtime(self, component: dict[str, Any], core_mask: int | None = None) -> Any:
        from rknnlite.api import RKNNLite

        model_path = self.model_path.parent / component["file"]
        runtime = RKNNLite(verbose=False)
        try:
            if runtime.load_rknn(str(model_path)) != 0:
                raise UvrBackendError(f"failed to load RKNN model {model_path}")
            if runtime.init_runtime(core_mask=self._core_mask if core_mask is None else core_mask) != 0:
                raise UvrBackendError(f"failed to initialise RKNN model {model_path}")
        except Exception:
            runtime.release()
            raise
        return runtime

    def _initialise_runtimes(self) -> None:
        from rknnlite.api import RKNNLite

        core_name = os.environ.get("NIGHTINGALE_RKNN_CORE", "all").strip().lower()
        masks = {
            "all": RKNNLite.NPU_CORE_ALL,
            "0": RKNNLite.NPU_CORE_0,
            "1": RKNNLite.NPU_CORE_1,
            "2": RKNNLite.NPU_CORE_2,
            "0_1": RKNNLite.NPU_CORE_0_1,
            "0_1_2": RKNNLite.NPU_CORE_0_1_2,
        }
        if core_name not in masks:
            raise UvrBackendError(f"unsupported NIGHTINGALE_RKNN_CORE={core_name!r}")
        self._core_mask = masks[core_name]
        components = (
            self.metadata["components"][:1]
            if self._stream_components
            else self.metadata["components"]
        )
        try:
            for component in components:
                runtime = self._load_runtime(component)
                self._runtimes.append((component, runtime))
        except Exception as exc:
            self.close()
            if isinstance(exc, UvrBackendError):
                raise
            raise UvrBackendError(f"failed to initialise RKNN runtime: {exc}") from exc
        print(
            f"[nightingale:LOG] RKNN Runtime: {self._runtimes[0][1].get_sdk_version()}",
            flush=True,
        )
        print(f"[nightingale:LOG] RKNN model: {self.model_path}", flush=True)
        if self._stream_components:
            print(
                f"[nightingale:LOG] RKNN contexts: 1 at a time "
                f"({len(self.metadata['components'])} components)",
                flush=True,
            )
            self._runtimes[0][1].release()
            self._runtimes.clear()
        else:
            print(f"[nightingale:LOG] RKNN contexts: {len(self._runtimes)}", flush=True)
        print(f"[nightingale:LOG] RKNN NPU cores: {core_name}", flush=True)
        if self._parallel_cores:
            print("[nightingale:LOG] RKNN transformer slices: 3 parallel NPU cores", flush=True)

    @contextmanager
    def _runtime(self, index: int) -> Iterator[tuple[dict[str, Any], Any]]:
        if not self._stream_components:
            yield self._runtimes[index]
            return
        component = self.metadata["components"][index]
        runtime = self._load_runtime(component)
        try:
            yield component, runtime
        finally:
            runtime.release()

    def _run_component(
        self, component: dict[str, Any], runtime: Any, tensor: np.ndarray
    ) -> np.ndarray:
        expected_input = tuple(component["input_shape"])
        if tuple(tensor.shape) != expected_input:
            raise UvrBackendError(
                f"{component['file']} input is {tuple(tensor.shape)}, expected {expected_input}"
            )
        contiguous = np.ascontiguousarray(tensor, dtype=np.float32)
        if tensor.ndim == 4:
            # RKNN Lite otherwise assumes a Python 4-D buffer is NHWC and
            # transposes it.  Component shapes are the exact ONNX axis order
            # (BTFD for mask heads), so mark the memory as matching the
            # model's declared NCHW order and prevent that implicit shuffle.
            outputs = runtime.inference(inputs=[contiguous], data_format="nchw")
        else:
            outputs = runtime.inference(inputs=[contiguous])
        if not outputs or len(outputs) != 1:
            raise UvrBackendError(
                f"{component['file']} returned {len(outputs) if outputs else 0} outputs"
            )
        output = np.asarray(outputs[0], dtype=np.float32)
        if self._stream_components:
            output = output.copy()
        expected_output = tuple(component["output_shape"])
        if tuple(output.shape) != expected_output:
            raise UvrBackendError(
                f"{component['file']} output is {tuple(output.shape)}, expected {expected_output}"
            )
        if not np.isfinite(output).all():
            raise UvrBackendError(f"{component['file']} returned NaN or Inf")
        return output

    def _run_transformer_axis(
        self, index: int, view: np.ndarray, pool: ThreadPoolExecutor | None
    ) -> np.ndarray:
        component = self.metadata["components"][index]
        step = int(component["host_batch_size"])
        slices = [view[start : start + step] for start in range(0, view.shape[0], step)]
        if pool is None:
            with self._runtime(index) as (_, runtime):
                outputs = [
                    self._run_component(component, runtime, tensor) for tensor in slices
                ]
            return np.concatenate(outputs, axis=0)

        from rknnlite.api import RKNNLite

        masks = (RKNNLite.NPU_CORE_0, RKNNLite.NPU_CORE_1, RKNNLite.NPU_CORE_2)
        runtimes = []
        try:
            for mask in masks:
                runtimes.append(self._load_runtime(component, core_mask=mask))

            def run_lane(lane: int) -> list[tuple[int, np.ndarray]]:
                runtime = runtimes[lane]
                return [
                    (slice_index, self._run_component(component, runtime, slices[slice_index]))
                    for slice_index in range(lane, len(slices), len(runtimes))
                ]

            futures = [pool.submit(run_lane, lane) for lane in range(len(runtimes))]
            outputs: list[np.ndarray | None] = [None] * len(slices)
            first_error: Exception | None = None
            for future in futures:
                try:
                    for slice_index, output in future.result():
                        outputs[slice_index] = output
                except Exception as exc:
                    if first_error is None:
                        first_error = exc
            if first_error is not None:
                raise first_error
            if any(output is None for output in outputs):
                raise UvrBackendError(f"{component['file']} returned incomplete slices")
            return np.concatenate(outputs, axis=0)
        finally:
            for runtime in reversed(runtimes):
                runtime.release()

    def _preprocess(self, raw_audio: torch.Tensor) -> tuple[np.ndarray, torch.Tensor]:
        if raw_audio.ndim != 3 or raw_audio.shape[1] != self.audio_channels:
            raise UvrBackendError(
                f"RKNN UVR input must be [batch,{self.audio_channels},samples], "
                f"got {tuple(raw_audio.shape)}"
            )
        expected_samples = int(self.metadata["chunk_samples"])
        if raw_audio.shape[-1] != expected_samples:
            raise UvrBackendError(
                f"RKNN UVR requires {expected_samples} samples per chunk, "
                f"got {raw_audio.shape[-1]}"
            )
        raw_audio = raw_audio.detach().cpu().float().contiguous()
        batch, channels, samples = raw_audio.shape
        packed_audio = raw_audio.reshape(batch * channels, samples)
        stft = torch.stft(
            packed_audio,
            **self.stft_kwargs,
            window=self.stft_window,
            return_complex=True,
        )
        stft_real = torch.view_as_real(stft).reshape(
            batch, channels, stft.shape[-2], stft.shape[-1], 2
        )
        stft_merged = stft_real.permute(0, 2, 1, 3, 4).reshape(
            batch, stft.shape[-2] * channels, stft.shape[-1], 2
        )
        gathered = stft_merged[:, self.freq_indices]
        features = gathered.permute(0, 2, 1, 3).reshape(batch, stft.shape[-1], -1)
        expected_shape = tuple(self.metadata["core_input_shape"])
        if tuple(features.shape) != expected_shape:
            raise UvrBackendError(
                f"RKNN feature shape mismatch: got {tuple(features.shape)}, "
                f"expected {expected_shape}"
            )
        return np.ascontiguousarray(features.numpy(), dtype=np.float32), stft_merged

    def _postprocess(
        self, flat_masks: np.ndarray, stft_real: torch.Tensor, output_length: int
    ) -> torch.Tensor:
        masks = _rotate_mask_layout(np.asarray(flat_masks, dtype=np.float32), self.metadata)
        batch = stft_real.shape[0]
        merged_freqs = stft_real.shape[1]
        frames = stft_real.shape[2]
        stft_complex = torch.view_as_complex(stft_real.contiguous()).unsqueeze(1)
        masks_complex = torch.view_as_complex(masks.contiguous())
        expanded = stft_complex.expand(-1, self.num_stems, -1, -1)
        summed = torch.zeros_like(expanded)
        indices = self.freq_indices.view(1, 1, -1, 1).expand(
            batch, self.num_stems, -1, frames
        )
        summed.scatter_add_(2, indices, masks_complex)
        denominator = self.num_bands_per_freq.repeat_interleave(self.audio_channels)
        averaged = summed / denominator.clamp(min=1e-8).view(1, 1, merged_freqs, 1)
        masked = stft_complex * averaged
        freq_bins = merged_freqs // self.audio_channels
        packed = masked.reshape(
            batch, self.num_stems, freq_bins, self.audio_channels, frames
        ).permute(0, 1, 3, 2, 4)
        reconstructed = torch.istft(
            packed.reshape(batch * self.num_stems * self.audio_channels, freq_bins, frames),
            **self.stft_kwargs,
            window=self.stft_window,
            return_complex=False,
            length=output_length,
        ).reshape(batch, self.num_stems, self.audio_channels, output_length)
        return reconstructed[:, 0] if self.num_stems == 1 else reconstructed

    def infer(self, tensor: torch.Tensor) -> torch.Tensor:
        if self._closed or (not self._stream_components and not self._runtimes):
            raise UvrBackendError("RKNN backend is closed")
        if tensor.ndim != 3:
            raise UvrBackendError(
                f"RKNN UVR input must have 3 dimensions, got {tensor.ndim}"
            )
        output_length = tensor.shape[-1]
        chunk_samples = int(self.metadata["chunk_samples"])
        if output_length <= 0 or output_length > chunk_samples:
            raise UvrBackendError(
                f"RKNN UVR supports chunks from 1 to {chunk_samples} samples, "
                f"got {output_length}"
            )
        if output_length < chunk_samples:
            tensor = torch.nn.functional.pad(tensor, (0, chunk_samples - output_length))
        total_start = time.perf_counter()
        features, stft = self._preprocess(tensor)
        preprocess_end = time.perf_counter()
        with self._runtime(0) as (band_component, band_runtime):
            encoded = self._run_component(band_component, band_runtime, features)

        batch, time_frames, frequency_bands, dimension = encoded.shape
        if batch != 1:
            raise UvrBackendError(f"RKNN UVR only supports batch 1, got {batch}")
        executor = ThreadPoolExecutor(max_workers=3) if self._parallel_cores else nullcontext(None)
        with executor as pool:
            for layer in range(6):
                time_view = encoded.transpose(0, 2, 1, 3).reshape(
                    frequency_bands, time_frames, dimension
                )
                time_outputs = self._run_transformer_axis(1 + layer * 2, time_view, pool)
                encoded = time_outputs.reshape(
                    1, frequency_bands, time_frames, dimension
                ).transpose(0, 2, 1, 3)

                frequency_view = encoded.reshape(time_frames, frequency_bands, dimension)
                frequency_outputs = self._run_transformer_axis(
                    2 + layer * 2, frequency_view, pool
                )
                encoded = frequency_outputs.reshape(1, time_frames, frequency_bands, dimension)
                del time_outputs, frequency_outputs, time_view, frequency_view

        mask_outputs = []
        expected_band_start = 0
        for index in range(13, len(self.metadata["components"])):
            component = self.metadata["components"][index]
            band_start = int(component["band_start"])
            band_stop = int(component["band_stop"])
            if band_start != expected_band_start:
                raise UvrBackendError(
                    f"non-contiguous RKNN mask bands: {expected_band_start} -> {band_start}"
                )
            with self._runtime(index) as (_, runtime):
                mask_outputs.append(
                    self._run_component(
                        component, runtime, encoded[:, :, band_start:band_stop, :],
                    )
                )
            expected_band_start = band_stop
        if expected_band_start != encoded.shape[2]:
            raise UvrBackendError(
                f"RKNN mask bundle covers {expected_band_start} of {encoded.shape[2]} bands"
            )
        output = np.concatenate(mask_outputs, axis=-1)
        expected = tuple(self.metadata["core_output_shape"])
        if tuple(output.shape) != expected:
            raise UvrBackendError(
                f"RKNN output shape mismatch: got {tuple(output.shape)}, expected {expected}"
            )
        if not np.isfinite(output).all():
            raise UvrBackendError("RKNN inference returned NaN or Inf")
        inference_end = time.perf_counter()
        reconstructed = self._postprocess(output, stft, chunk_samples)
        reconstructed = reconstructed[..., :output_length]
        total_end = time.perf_counter()
        self.last_profile = {
            "preprocess_s": preprocess_end - total_start,
            "inference_s": inference_end - preprocess_end,
            "postprocess_s": total_end - inference_end,
            "total_s": total_end - total_start,
        }
        if os.environ.get("NIGHTINGALE_RKNN_PROFILE", "").strip() == "1":
            values = " ".join(
                f"{key}={value:.6f}" for key, value in self.last_profile.items()
            )
            print(f"[nightingale:LOG] RKNN profile: {values}", flush=True)
        return reconstructed

    def make_proxy_model(self) -> torch.nn.Module:
        backend = self

        class Proxy(torch.nn.Module):
            def __init__(self) -> None:
                super().__init__()
                self.anchor = torch.nn.Parameter(torch.zeros(1), requires_grad=False)

            def forward(self, raw_audio: torch.Tensor) -> torch.Tensor:
                return backend.infer(raw_audio)

        return Proxy().eval()

    def model_data(self) -> dict[str, Any]:
        """Return the exact audio-separator config captured during conversion."""

        return self.metadata["audio_separator_config"]

    def close(self) -> None:
        self._closed = True
        for _component, runtime in reversed(self._runtimes):
            runtime.release()
        self._runtimes.clear()


_CACHED_RKNN_BACKEND: RknnUvrBackend | None = None


def get_rknn_backend(models_dir: str) -> RknnUvrBackend:
    global _CACHED_RKNN_BACKEND
    metadata = resolve_rknn_model(models_dir)
    if _CACHED_RKNN_BACKEND is None or _CACHED_RKNN_BACKEND.model_path != metadata:
        if _CACHED_RKNN_BACKEND is not None:
            _CACHED_RKNN_BACKEND.close()
        _CACHED_RKNN_BACKEND = RknnUvrBackend(metadata)
    return _CACHED_RKNN_BACKEND


def release_rknn_backend() -> None:
    global _CACHED_RKNN_BACKEND
    if _CACHED_RKNN_BACKEND is not None:
        _CACHED_RKNN_BACKEND.close()
        _CACHED_RKNN_BACKEND = None


atexit.register(release_rknn_backend)
