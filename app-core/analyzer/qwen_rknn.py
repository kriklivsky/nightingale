"""Qwen3-ForcedAligner inference on the RK3588 NPU from a split RKNN bundle.

The bundle (built by ``tools/rknn/export_qwen_aligner.py`` and
``tools/rknn/build_qwen_aligner.py``) holds the audio encoder as layer groups
over one 8 s window and the causal text decoder as layer groups over a fixed
sequence length. The host keeps the processor, token embedding lookup, final
norm and timestamp classifier, which are cheap next to the transformer layers.
"""

import json
import os
from pathlib import Path

import numpy as np

BUNDLE_NAME = "Qwen3-ForcedAligner-0.6B.rk3588.fp16"
BUNDLE_FORMAT = "nightingale-qwen-aligner-rknn-v1"
AUDIO_CHUNK_FRAMES = 100


class AlignerUnavailable(Exception):
    """The NPU bundle, runtime or device is missing; use another aligner."""


def resolve_bundle(models_dir: str) -> Path:
    override = os.environ.get("NIGHTINGALE_QWEN_RKNN_MODEL")
    path = Path(override) if override else Path(models_dir) / "qwen_aligner" / BUNDLE_NAME
    manifest = path if path.suffix == ".json" else path / "manifest.json"
    if not manifest.is_file():
        raise AlignerUnavailable(f"no Qwen aligner RKNN bundle at {path}")
    from uvr_backend import rknn_device_available

    if not rknn_device_available():
        raise AlignerUnavailable("RKNPU device is not available")
    return manifest


def _post_cnn_tokens(frames: int) -> int:
    for _ in range(3):
        frames = (frames - 1) // 2 + 1 if frames > 0 else 0
    return frames


class _RknnRunner:
    def __init__(self, path: Path):
        from rknnlite.api import RKNNLite

        self.runtime = RKNNLite(verbose=False)
        if self.runtime.load_rknn(str(path)) != 0:
            raise AlignerUnavailable(f"cannot load {path.name}")
        if self.runtime.init_runtime(core_mask=RKNNLite.NPU_CORE_0_1_2) != 0:
            self.runtime.release()
            raise AlignerUnavailable(f"cannot initialise {path.name}")
        # init_runtime builds the graph into NPU memory; the file bytes kept by
        # RKNNLite are only read there and would double the bundle in RAM.
        self.runtime.rknn_data = None

    def __call__(self, *inputs: np.ndarray) -> np.ndarray:
        outputs = self.runtime.inference(inputs=[np.ascontiguousarray(x, dtype=np.float32) for x in inputs])
        if not outputs or not np.all(np.isfinite(outputs[0])):
            raise RuntimeError("Qwen aligner NPU output is not finite")
        return outputs[0]

    def close(self) -> None:
        self.runtime.release()


class _OnnxRunner:
    """Reference runner for validating a bundle against its ONNX sources.

    Sessions are created per call so only one FP32 component is resident.
    """

    def __init__(self, path: Path):
        self.path = path

    def __call__(self, *inputs: np.ndarray) -> np.ndarray:
        import onnxruntime

        session = onnxruntime.InferenceSession(str(self.path), providers=["CPUExecutionProvider"])
        names = [item.name for item in session.get_inputs()]
        feed = {name: np.ascontiguousarray(x, dtype=np.float32) for name, x in zip(names, inputs)}
        return session.run(None, feed)[0]

    def close(self) -> None:
        pass


class SplitAligner:
    def __init__(self, manifest_path: Path, runner: str = "rknn"):
        from huggingface_hub import hf_hub_download
        from safetensors import safe_open
        from transformers import AutoConfig, AutoProcessor

        self.manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if self.manifest.get("bundle_format") != BUNDLE_FORMAT:
            raise AlignerUnavailable("unsupported Qwen aligner bundle format")
        model, revision = self.manifest["model"], self.manifest["revision"]
        self.processor = AutoProcessor.from_pretrained(model, revision=revision)
        config = AutoConfig.from_pretrained(model, revision=revision)
        self.audio_token_id = config.audio_token_id
        self.timestamp_token_id = config.timestamp_token_id
        self.eps = config.text_config.rms_norm_eps
        self.weights_path = hf_hub_download(model, "model.safetensors", revision=revision)
        with safe_open(self.weights_path, "pt") as weights:
            self.norm = weights.get_tensor("model.language_model.norm.weight").float().numpy()
            self.score = weights.get_tensor("score.weight").float().numpy()
        self.frames = self.manifest["encoder_frames"]
        self.tokens = self.manifest["encoder_tokens"]
        self.length = self.manifest["sequence_length"]
        self.max_sequence = self.length
        self.mask_value = self.manifest["mask_value"]
        factory = _RknnRunner if runner == "rknn" else _OnnxRunner
        base = manifest_path.parent
        self.encoder = []
        self.decoder = []
        try:
            for component in self.manifest["components"]:
                target = self.encoder if component["kind"] == "encoder" else self.decoder
                target.append(factory(base / component["file" if runner == "rknn" else "onnx"]))
        except Exception:
            self.close()
            raise

    def close(self) -> None:
        for runner in self.encoder + self.decoder:
            runner.close()
        self.encoder = []
        self.decoder = []

    def _encode(self, features: np.ndarray, valid_frames: int) -> np.ndarray:
        """Audio embeddings for ``features`` (mel bins x frames), window by window."""
        out = []
        tokens_per_chunk = self.tokens * AUDIO_CHUNK_FRAMES // self.frames
        for start in range(0, valid_frames, self.frames):
            window = np.zeros((1, features.shape[0], self.frames), dtype=np.float32)
            stop = min(start + self.frames, features.shape[1])
            window[0, :, : stop - start] = features[:, start:stop]
            keep = np.zeros(self.tokens, dtype=bool)
            for chunk in range(self.frames // AUDIO_CHUNK_FRAMES):
                frames = min(max(valid_frames - start - chunk * AUDIO_CHUNK_FRAMES, 0), AUDIO_CHUNK_FRAMES)
                first = chunk * tokens_per_chunk
                keep[first : first + _post_cnn_tokens(frames)] = True
            mask = np.where(keep, 0.0, self.mask_value).astype(np.float32).reshape(1, 1, 1, -1)
            hidden = window
            for runner in self.encoder:
                hidden = runner(hidden, mask)
            out.append(hidden.reshape(self.tokens, -1)[keep])
        return np.concatenate(out)

    def _embed(self, ids: np.ndarray) -> np.ndarray:
        from safetensors import safe_open

        rows = {}
        with safe_open(self.weights_path, "pt") as weights:
            table = weights.get_slice("model.language_model.embed_tokens.weight")
            for token in np.unique(ids):
                rows[int(token)] = table[int(token) : int(token) + 1].float().numpy()[0]
        return np.stack([rows[int(token)] for token in ids])

    def fits(self, seconds: float, text: str, language: str) -> bool:
        inputs, _ = self.processor.prepare_forced_aligner_inputs(
            audio=[np.zeros(int(seconds * 16000), dtype=np.float32)], transcript=[text], language=language,
        )
        return inputs["input_ids"].shape[1] <= self.length

    def align(self, audio: np.ndarray, text: str, language: str) -> list[dict]:
        import torch

        inputs, word_lists = self.processor.prepare_forced_aligner_inputs(
            audio=[audio], transcript=[text], language=language,
        )
        ids = inputs["input_ids"][0].numpy()
        if len(ids) > self.length:
            raise ValueError(f"aligner input of {len(ids)} tokens exceeds {self.length}")
        features = inputs["input_features"][0].float().numpy()
        valid_frames = int(inputs["input_features_mask"][0].sum())
        hidden = self._embed(ids)
        audio_positions = ids == self.audio_token_id
        hidden[audio_positions] = self._encode(features, valid_frames)

        padded = np.zeros((1, self.length, hidden.shape[1]), dtype=np.float32)
        padded[0, : len(ids)] = hidden
        for runner in self.decoder:
            padded = runner(padded)
        hidden = padded[0, : len(ids)]

        stamps = ids == self.timestamp_token_id
        selected = hidden[stamps].astype(np.float64)
        normed = selected / np.sqrt(np.mean(selected**2, axis=-1, keepdims=True) + self.eps) * self.norm
        logits = np.zeros((1, len(ids), self.score.shape[0]), dtype=np.float32)
        logits[0, stamps] = normed @ self.score.T
        return self.processor.decode_forced_alignment(
            logits=torch.from_numpy(logits),
            input_ids=inputs["input_ids"],
            word_lists=word_lists,
            timestamp_token_id=self.timestamp_token_id,
        )[0]
