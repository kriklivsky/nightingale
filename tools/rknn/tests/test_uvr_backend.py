from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import torch


REPOSITORY = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPOSITORY / "app-core" / "analyzer"))

import uvr_backend  # noqa: E402


def component_names() -> list[str]:
    names = ["band-split"]
    for layer in range(6):
        names.append(f"transformer-{layer:02d}-time")
        names.append(f"transformer-{layer:02d}-frequency")
    names.extend(f"mask-{start:02d}-{start + 10:02d}" for start in range(0, 60, 10))
    return names


def component_shapes() -> list[tuple[list[int], list[int]]]:
    shapes = [([1, 801, 7916], [1, 801, 60, 384])]
    for _layer in range(6):
        shapes.extend(
            [([5, 801, 384], [5, 801, 384]), ([89, 60, 384], [89, 60, 384])]
        )
    shapes.extend(
        ([1, 801, 10, 384], [1, 801, width])
        for width in (244, 276, 508, 1008, 1980, 3900)
    )
    return shapes


class FakeRuntime:
    def __init__(self, output):
        self.output = output
        self.data_formats = []

    def inference(self, inputs, data_format=None):
        self.data_formats.append(data_format)
        return [self.output(inputs[0])]

    def release(self):
        pass


class BackendSelectionTests(unittest.TestCase):
    def test_auto_uses_rknn_when_ready(self):
        with patch.dict(os.environ, {"NIGHTINGALE_UVR_BACKEND": "auto"}), patch.object(
            uvr_backend, "_rknn_readiness", return_value=(True, "ready")
        ):
            self.assertEqual(uvr_backend.select_uvr_backend("/models"), "rknn")

    def test_auto_falls_back_when_rknn_is_unavailable(self):
        with patch.dict(os.environ, {"NIGHTINGALE_UVR_BACKEND": "auto"}), patch.object(
            uvr_backend, "_rknn_readiness", return_value=(False, "not RK3588")
        ):
            self.assertEqual(uvr_backend.select_uvr_backend("/models"), "existing")

    def test_explicit_rknn_never_falls_back(self):
        with patch.dict(os.environ, {"NIGHTINGALE_UVR_BACKEND": "rknn"}), patch.object(
            uvr_backend, "_rknn_readiness", return_value=(False, "model missing")
        ):
            with self.assertRaisesRegex(uvr_backend.UvrBackendError, "model missing"):
                uvr_backend.select_uvr_backend("/models")


class MetadataTests(unittest.TestCase):
    def make_manifest(self, directory: Path) -> Path:
        digest = hashlib.sha256(b"component").hexdigest()
        components = []
        for name, (input_shape, output_shape) in zip(component_names(), component_shapes()):
            (directory / f"{name}.rknn").write_bytes(b"component")
            components.append(
                {
                    "file": f"{name}.rknn",
                    "sha256": digest,
                    "input_shape": input_shape,
                    "output_shape": output_shape,
                }
            )
        manifest = {
            "format_version": 1,
            "bundle_format": "nightingale-split-rknn-v1",
            "target": "rk3588",
            "source_sha256": uvr_backend.SUPPORTED_SOURCE_SHA256,
            **uvr_backend.EXPECTED_MODEL_METADATA,
            "stft": uvr_backend.EXPECTED_STFT_METADATA,
            "audio_separator_config": {},
            "freq_indices": [0] * 3958,
            "num_bands_per_freq": [1] * 1025,
            "components": components,
        }
        path = directory / "manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        return path

    def test_manifest_and_component_hashes_are_validated(self):
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            manifest = self.make_manifest(directory)
            self.assertEqual(len(uvr_backend._validate_metadata(manifest)["components"]), 19)
            (directory / "transformer-03-time.rknn").write_bytes(b"corrupt")
            with self.assertRaisesRegex(uvr_backend.UvrBackendError, "checksum mismatch"):
                uvr_backend._validate_metadata(manifest)

    def test_incompatible_model_metadata_is_rejected(self):
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            manifest = self.make_manifest(directory)
            metadata = json.loads(manifest.read_text(encoding="utf-8"))
            metadata["sample_rate"] = 48000
            manifest.write_text(json.dumps(metadata), encoding="utf-8")
            with self.assertRaisesRegex(uvr_backend.UvrBackendError, "sample_rate"):
                uvr_backend._validate_metadata(manifest)


class TensorAdapterTests(unittest.TestCase):
    def test_mask_layout_matches_roformer_complex_order(self):
        flat = np.arange(24, dtype=np.float32).reshape(1, 2, 12)
        masks = uvr_backend._rotate_mask_layout(
            flat, {"num_stems": 1, "gathered_frequency_bins": 6}
        )
        self.assertEqual(tuple(masks.shape), (1, 1, 6, 2, 2))
        np.testing.assert_array_equal(masks.numpy()[0, 0, :, 0, :], flat[0, 0].reshape(6, 2))

    def test_split_components_preserve_axis_and_band_order(self):
        backend = object.__new__(uvr_backend.RknnUvrBackend)
        backend.metadata = {"chunk_samples": 4, "core_output_shape": [1, 2, 60]}
        features = np.zeros((1, 2, 1), dtype=np.float32)
        encoded = np.zeros((1, 2, 60, 1), dtype=np.float32)
        runtimes = [
            (
                {"file": "band-split.rknn", "input_shape": [1, 2, 1], "output_shape": [1, 2, 60, 1]},
                FakeRuntime(lambda _input: encoded.copy()),
            )
        ]
        for layer in range(6):
            runtimes.append(
                (
                    {
                        "file": f"transformer-{layer:02d}-time.rknn",
                        "input_shape": [5, 2, 1],
                        "output_shape": [5, 2, 1],
                        "host_batch_size": 5,
                    },
                    FakeRuntime(lambda input_tensor: input_tensor + 1),
                )
            )
            runtimes.append(
                (
                    {
                        "file": f"transformer-{layer:02d}-frequency.rknn",
                        "input_shape": [1, 60, 1],
                        "output_shape": [1, 60, 1],
                        "host_batch_size": 1,
                    },
                    FakeRuntime(lambda input_tensor: input_tensor + 1),
                )
            )
        for start in range(0, 60, 10):
            runtimes.append(
                (
                    {
                        "file": f"mask-{start:02d}-{start + 10:02d}.rknn",
                        "band_start": start,
                        "band_stop": start + 10,
                        "input_shape": [1, 2, 10, 1],
                        "output_shape": [1, 2, 10],
                    },
                    FakeRuntime(lambda input_tensor: input_tensor[..., 0]),
                )
            )
        backend._runtimes = runtimes
        preprocess_lengths = []
        captured = {}

        def fake_preprocess(tensor):
            preprocess_lengths.append(tensor.shape[-1])
            return features, None

        def fake_postprocess(output, _stft, output_length):
            captured["masks"] = output
            return torch.zeros((1, 2, output_length))

        backend._preprocess = fake_preprocess
        backend._postprocess = fake_postprocess

        output = backend.infer(torch.zeros((1, 2, 4)))
        self.assertEqual(tuple(output.shape), (1, 2, 4))
        self.assertEqual(tuple(captured["masks"].shape), (1, 2, 60))
        self.assertTrue(np.equal(captured["masks"], 12.0).all())

        short_output = backend.infer(torch.zeros((1, 2, 2)))
        self.assertEqual(tuple(short_output.shape), (1, 2, 2))
        self.assertEqual(preprocess_lengths, [4, 4])
        self.assertTrue(
            all(runtime.data_formats == ["nchw", "nchw"] for _, runtime in runtimes[13:])
        )
        self.assertTrue(
            all(
                data_format is None
                for _, runtime in runtimes[:13]
                for data_format in runtime.data_formats
            )
        )


if __name__ == "__main__":
    unittest.main()
