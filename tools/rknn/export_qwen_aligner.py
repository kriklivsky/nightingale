#!/usr/bin/env python3
"""Export Qwen3-ForcedAligner-0.6B as static-shape ONNX components for RK3588.

The audio encoder attends within fixed 8 s windows, so one window (800 mel
frames -> 104 audio tokens) is a complete component; a key mask covers a
shorter final window. The causal text decoder is split into groups of layers
over a fixed sequence length; right padding cannot change earlier positions.
Token embedding, the final norm and the timestamp classifier stay on the host.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import torch
import torch.nn.functional as F
from torch import nn

MODEL_ID = "Qwen/Qwen3-ForcedAligner-0.6B-hf"
ENCODER_FRAMES = 800
ENCODER_CHUNK_FRAMES = 100
ENCODER_TOKENS = 104
SEQUENCE_LENGTH = 1024
LAYERS_PER_GROUP = 4
ENCODER_LAYERS_PER_GROUP = 8
# Large enough to zero a softmax weight, small enough for FP16.
MASK_VALUE = -1e4
# RMS is computed on x / NORM_SCALE so FP16 squares of the residual stream stay finite.
NORM_SCALE = 64.0


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def rms_norm(norm: nn.Module, x: torch.Tensor) -> torch.Tensor:
    scaled = x / NORM_SCALE
    variance = scaled.pow(2).mean(-1, keepdim=True)
    return scaled * torch.rsqrt(variance + norm.variance_epsilon / NORM_SCALE**2) * norm.weight


class EncoderGroup(nn.Module):
    """Encoder layers ``first:first + count`` of one 8 s window.

    The first group also runs the convolutional front end on mel input; the
    last group adds the output norm and the audio-to-text projector.
    """

    def __init__(self, model: nn.Module, first: int, count: int) -> None:
        super().__init__()
        encoder = model.model.audio_tower
        self.first = first == 0
        self.last = first + count == len(encoder.layers)
        self.layers = encoder.layers[first : first + count]
        self.heads = encoder.config.encoder_attention_heads
        if self.first:
            self.conv2d1 = encoder.conv2d1
            self.conv2d2 = encoder.conv2d2
            self.conv2d3 = encoder.conv2d3
            self.conv_out = encoder.conv_out
            tokens_per_chunk = ENCODER_TOKENS * ENCODER_CHUNK_FRAMES // ENCODER_FRAMES
            positions = encoder.positional_embedding.compute_default_singular_positional_embedding()
            self.register_buffer("positions", positions[:tokens_per_chunk].clone())
        if self.last:
            self.ln_post = encoder.ln_post
            self.projector = model.model.multi_modal_projector

    def attention(self, layer: nn.Module, hidden: torch.Tensor, key_mask: torch.Tensor):
        attn = layer.self_attn
        batch, length, width = hidden.shape
        head_dim = width // self.heads

        def heads(projection: nn.Module) -> torch.Tensor:
            return projection(hidden).reshape(batch, length, self.heads, head_dim).transpose(1, 2)

        weights = torch.softmax(
            heads(attn.q_proj) @ heads(attn.k_proj).transpose(2, 3) * attn.scaling + key_mask,
            dim=-1,
        )
        context = (weights @ heads(attn.v_proj)).transpose(1, 2).reshape(batch, length, width)
        return attn.out_proj(context)

    def front(self, mel: torch.Tensor) -> torch.Tensor:
        chunks = ENCODER_FRAMES // ENCODER_CHUNK_FRAMES
        x = mel.reshape(1, mel.shape[1], chunks, ENCODER_CHUNK_FRAMES).permute(0, 2, 1, 3)
        x = x.reshape(chunks, 1, mel.shape[1], ENCODER_CHUNK_FRAMES)
        x = F.gelu(self.conv2d1(x))
        x = F.gelu(self.conv2d2(x))
        x = F.gelu(self.conv2d3(x))
        count, channels, bins, steps = x.shape
        x = self.conv_out(x.permute(0, 3, 1, 2).reshape(count, steps, channels * bins))
        return (x + self.positions).reshape(1, count * steps, -1)

    def forward(self, hidden: torch.Tensor, key_mask: torch.Tensor) -> torch.Tensor:
        if self.first:
            hidden = self.front(hidden)
        for layer in self.layers:
            hidden = hidden + self.attention(layer, layer.self_attn_layer_norm(hidden), key_mask)
            hidden = hidden + layer.fc2(F.gelu(layer.fc1(layer.final_layer_norm(hidden))))
        if self.last:
            hidden = self.projector(self.ln_post(hidden))
        return hidden


class DecoderGroup(nn.Module):
    def __init__(self, model: nn.Module, first: int, count: int) -> None:
        super().__init__()
        language_model = model.model.language_model
        self.layers = language_model.layers[first : first + count]
        config = language_model.config
        self.heads = config.num_attention_heads
        self.kv_heads = config.num_key_value_heads
        self.head_dim = config.head_dim
        theta = config.rope_parameters["rope_theta"]
        exponents = torch.arange(0, self.head_dim, 2, dtype=torch.float64) / self.head_dim
        angles = torch.arange(SEQUENCE_LENGTH, dtype=torch.float64)[:, None] / theta**exponents
        angles = torch.cat((angles, angles), dim=-1)
        self.register_buffer("cos", angles.cos().float()[None, None])
        self.register_buffer("sin", angles.sin().float()[None, None])
        mask = torch.full((SEQUENCE_LENGTH, SEQUENCE_LENGTH), MASK_VALUE).triu(1)
        self.register_buffer("mask", mask[None, None])

    def rotate(self, x: torch.Tensor) -> torch.Tensor:
        half = x.shape[-1] // 2
        rotated = torch.cat((-x[..., half:], x[..., :half]), dim=-1)
        return x * self.cos + rotated * self.sin

    def attention(self, layer: nn.Module, hidden: torch.Tensor) -> torch.Tensor:
        attn = layer.self_attn
        batch, length, _ = hidden.shape

        def heads(projection: nn.Module, count: int, norm: nn.Module | None) -> torch.Tensor:
            x = projection(hidden).reshape(batch, length, count, self.head_dim)
            if norm is not None:
                x = rms_norm(norm, x)
            return x.transpose(1, 2)

        query = self.rotate(heads(attn.q_proj, self.heads, attn.q_norm))
        key = self.rotate(heads(attn.k_proj, self.kv_heads, attn.k_norm))
        value = heads(attn.v_proj, self.kv_heads, None)
        repeat = self.heads // self.kv_heads
        key = key.repeat_interleave(repeat, dim=1)
        value = value.repeat_interleave(repeat, dim=1)
        weights = torch.softmax(query @ key.transpose(2, 3) * attn.scaling + self.mask, dim=-1)
        context = (weights @ value).transpose(1, 2).reshape(batch, length, -1)
        return attn.o_proj(context)

    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        for layer in self.layers:
            hidden = hidden + self.attention(layer, rms_norm(layer.input_layernorm, hidden))
            mlp = layer.mlp
            normed = rms_norm(layer.post_attention_layernorm, hidden)
            hidden = hidden + mlp.down_proj(F.silu(mlp.gate_proj(normed)) * mlp.up_proj(normed))
        return hidden


def export(module: nn.Module, inputs: tuple, names: list[str], output: Path) -> None:
    torch.onnx.export(
        module,
        inputs,
        str(output),
        input_names=names,
        output_names=["output"],
        opset_version=17,
        dynamo=False,
    )


def component_plan(config) -> list[tuple[str, str, int, int]]:
    plan = []
    encoder_layers = config.audio_config.encoder_layers
    for first in range(0, encoder_layers, ENCODER_LAYERS_PER_GROUP):
        last = first + ENCODER_LAYERS_PER_GROUP
        plan.append((f"encoder-{first:02d}-{last:02d}", "encoder", first, ENCODER_LAYERS_PER_GROUP))
    for first in range(0, config.text_config.num_hidden_layers, LAYERS_PER_GROUP):
        last = first + LAYERS_PER_GROUP
        plan.append((f"decoder-{first:02d}-{last:02d}", "decoder", first, LAYERS_PER_GROUP))
    return plan


def export_component(args: argparse.Namespace, config, name: str, kind: str, first: int, count: int):
    from transformers import AutoModelForTokenClassification

    model = AutoModelForTokenClassification.from_pretrained(
        args.model, revision=args.revision, dtype=torch.bfloat16, attn_implementation="eager"
    ).eval()
    if kind == "encoder":
        module = EncoderGroup(model, first, count)
        width = config.audio_config.num_mel_bins if first == 0 else config.audio_config.d_model
        hidden = (
            torch.randn(1, width, ENCODER_FRAMES)
            if first == 0
            else torch.randn(1, ENCODER_TOKENS, width)
        )
        inputs = (hidden, torch.zeros(1, 1, 1, ENCODER_TOKENS))
        names = ["hidden", "key_mask"]
    else:
        module = DecoderGroup(model, first, count)
        inputs = (torch.randn(1, SEQUENCE_LENGTH, config.text_config.hidden_size),)
        names = ["hidden"]
    del model
    module = module.float()
    output = args.output_dir / f"{name}.onnx"
    with torch.inference_mode():
        export(module, inputs, names, output)
    record = {
        "name": name,
        "kind": kind,
        "first_layer": first,
        "layers": count,
        "onnx": output.name,
        "onnx_sha256": sha256(output),
        "inputs": {key: list(value.shape) for key, value in zip(names, inputs)},
    }
    Path(f"{output}.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=MODEL_ID)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--component")
    args = parser.parse_args()

    from transformers import AutoConfig

    config = AutoConfig.from_pretrained(args.model, revision=args.revision)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    plan = component_plan(config)
    if args.component is not None:
        selected = [item for item in plan if item[0] == args.component]
        if not selected:
            raise SystemExit(f"unknown component {args.component}")
        export_component(args, config, *selected[0])
        return

    for name, *_ in plan:
        print(f"export {name}", flush=True)
        command = [
            sys.executable, __file__, "--model", args.model, "--revision", args.revision,
            "--output-dir", str(args.output_dir), "--component", name,
        ]
        if subprocess.run(command).returncode != 0:
            raise SystemExit(f"export of {name} failed")

    manifest = {
        "model": args.model,
        "revision": args.revision,
        "encoder_frames": ENCODER_FRAMES,
        "encoder_tokens": ENCODER_TOKENS,
        "sequence_length": SEQUENCE_LENGTH,
        "mask_value": MASK_VALUE,
        "components": [
            json.loads(Path(f"{args.output_dir / name}.onnx.json").read_text(encoding="utf-8"))
            for name, *_ in plan
        ],
    }
    (args.output_dir / "onnx-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
