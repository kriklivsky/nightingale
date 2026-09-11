"""Static, RKNN-friendly neural core for Nightingale's MelBand-Roformer."""

from __future__ import annotations

import torch
from torch import nn


def _rotate_half(tensor: torch.Tensor) -> torch.Tensor:
    pairs = tensor.reshape(*tensor.shape[:-1], tensor.shape[-1] // 2, 2)
    first, second = pairs.unbind(dim=-1)
    return torch.stack((-second, first), dim=-1).flatten(-2)


class FixedAttention(nn.Module):
    def __init__(
        self, source: nn.Module, sequence_length: int, batch_chunk_size: int
    ):
        super().__init__()
        self.norm = source.norm
        self.to_qkv = source.to_qkv
        self.to_gates = source.to_gates
        self.to_out = source.to_out
        self.heads = source.heads
        self.head_dim = source.to_qkv.out_features // (3 * source.heads)
        self.scale = self.head_dim**-0.5
        self.batch_chunk_size = batch_chunk_size

        rotary = source.rotary_embed
        positions = torch.arange(sequence_length, dtype=torch.float32)
        angles = torch.einsum("n,f->nf", positions, rotary.freqs.detach().float())
        angles = torch.repeat_interleave(angles, 2, dim=-1)
        self.register_buffer("rotary_cos", angles.cos().view(1, 1, sequence_length, -1))
        self.register_buffer("rotary_sin", angles.sin().view(1, 1, sequence_length, -1))

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        tensor = self.norm(tensor)
        batch, length, _ = tensor.shape
        qkv = self.to_qkv(tensor).reshape(
            batch, length, 3, self.heads, self.head_dim
        ).permute(2, 0, 3, 1, 4)
        query, key, value = qkv[0], qkv[1], qkv[2]
        query = query * self.rotary_cos + _rotate_half(query) * self.rotary_sin
        key = key * self.rotary_cos + _rotate_half(key) * self.rotary_sin
        attended_chunks = []
        for query_chunk, key_chunk, value_chunk in zip(
            query.split(self.batch_chunk_size, dim=0),
            key.split(self.batch_chunk_size, dim=0),
            value.split(self.batch_chunk_size, dim=0),
        ):
            scores = (
                torch.matmul(query_chunk, key_chunk.transpose(-1, -2))
                * self.scale
            )
            attended_chunks.append(
                torch.matmul(torch.softmax(scores, dim=-1), value_chunk)
            )
        attended = torch.cat(attended_chunks, dim=0)
        gates = torch.sigmoid(self.to_gates(tensor)).permute(0, 2, 1).unsqueeze(-1)
        attended = attended * gates
        attended = attended.permute(0, 2, 1, 3).reshape(
            batch, length, self.heads * self.head_dim
        )
        return self.to_out(attended)


class FixedTransformer(nn.Module):
    def __init__(
        self, source: nn.Module, sequence_length: int, batch_chunk_size: int
    ):
        super().__init__()
        self.attentions = nn.ModuleList(
            [
                FixedAttention(attention, sequence_length, batch_chunk_size)
                for attention, _ in source.layers
            ]
        )
        self.feed_forwards = nn.ModuleList([feed_forward for _, feed_forward in source.layers])
        self.norm = source.norm

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        for attention, feed_forward in zip(self.attentions, self.feed_forwards):
            tensor = attention(tensor) + tensor
            tensor = feed_forward(tensor) + tensor
        return self.norm(tensor)


class BandSplitCore(nn.Module):
    """Project packed complex STFT bins into the model's mel bands."""

    def __init__(self, model: nn.Module):
        super().__init__()
        self.band_split = model.band_split

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return self.band_split(features)


class AxialTransformerCore(nn.Module):
    """Run a contiguous range of the time/frequency transformer stack."""

    def __init__(
        self,
        model: nn.Module,
        time_frames: int,
        layer_start: int = 0,
        layer_stop: int | None = None,
        time_batch_chunk: int = 5,
        frequency_batch_chunk: int = 89,
    ):
        super().__init__()
        self.frequency_bands = len(model.band_split.dim_inputs)
        self.dimension = model.layers[0][0].norm.gamma.numel()
        layer_stop = len(model.layers) if layer_stop is None else layer_stop
        if not 0 <= layer_start < layer_stop <= len(model.layers):
            raise ValueError(
                f"invalid transformer layer range [{layer_start}, {layer_stop})"
            )
        self.time_layers = nn.ModuleList()
        self.frequency_layers = nn.ModuleList()
        for time_transformer, frequency_transformer in model.layers[
            layer_start:layer_stop
        ]:
            self.time_layers.append(
                FixedTransformer(time_transformer, time_frames, time_batch_chunk)
            )
            self.frequency_layers.append(
                FixedTransformer(
                    frequency_transformer,
                    self.frequency_bands,
                    frequency_batch_chunk,
                )
            )

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        batch, time_frames, frequency_bands, dimension = tensor.shape
        for time_transformer, frequency_transformer in zip(
            self.time_layers, self.frequency_layers
        ):
            time_view = tensor.permute(0, 2, 1, 3).reshape(
                batch * frequency_bands, time_frames, dimension
            )
            time_view = time_transformer(time_view)
            tensor = time_view.reshape(
                batch, frequency_bands, time_frames, dimension
            ).permute(0, 2, 1, 3)
            frequency_view = tensor.reshape(
                batch * time_frames, frequency_bands, dimension
            )
            frequency_view = frequency_transformer(frequency_view)
            tensor = frequency_view.reshape(
                batch, time_frames, frequency_bands, dimension
            )
        return tensor


class TransformerAxisCore(nn.Module):
    """Run one transformer axis for a fixed host-side batch slice."""

    def __init__(
        self,
        model: nn.Module,
        time_frames: int,
        layer: int,
        axis: str,
        batch_size: int,
    ):
        super().__init__()
        if not 0 <= layer < len(model.layers):
            raise ValueError(f"invalid transformer layer {layer}")
        if axis == "time":
            source = model.layers[layer][0]
            sequence_length = time_frames
        elif axis == "frequency":
            source = model.layers[layer][1]
            sequence_length = len(model.band_split.dim_inputs)
        else:
            raise ValueError(f"invalid transformer axis {axis!r}")
        self.transformer = FixedTransformer(source, sequence_length, batch_size)

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        return self.transformer(tensor)


class MaskEstimatorCore(nn.Module):
    """Estimate complex masks for a contiguous set of mel bands."""

    def __init__(self, model: nn.Module, band_start: int, band_stop: int):
        super().__init__()
        if model.num_stems != 1:
            raise ValueError("the Nightingale RKNN export currently requires one stem")
        band_count = len(model.band_split.dim_inputs)
        if not 0 <= band_start < band_stop <= band_count:
            raise ValueError(f"invalid mask band range [{band_start}, {band_stop})")
        estimator = model.mask_estimators[0]
        self.to_freqs = nn.ModuleList(estimator.to_freqs[band_start:band_stop])

    def forward(self, tensor: torch.Tensor) -> torch.Tensor:
        band_features = tensor.unbind(dim=-2)
        outputs = [
            estimator(features)
            for features, estimator in zip(band_features, self.to_freqs)
        ]
        return torch.cat(outputs, dim=-1)


class UvrNeuralCore(nn.Module):
    """Monolithic reference core; deployment uses the smaller component cores."""

    def __init__(self, model: nn.Module, time_frames: int):
        super().__init__()
        self.band_split = BandSplitCore(model)
        self.transformers = AxialTransformerCore(model, time_frames)
        self.mask_estimator = MaskEstimatorCore(
            model, 0, len(model.band_split.dim_inputs)
        )

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        tensor = self.band_split(features)
        tensor = self.transformers(tensor)
        masks = self.mask_estimator(tensor)
        return masks
