# RK3588 UVR backend

This directory contains the reproducible conversion path for Nightingale's current
karaoke separator model. It accelerates only the MelBand-Roformer neural network;
audio decoding, normalization, chunking/overlap-add, STFT, mask reconstruction and
ISTFT remain in the existing `audio-separator` pipeline.

## Pinned source model

- Model: `mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt`
- SHA-256: `1de20d459332fe8869aeb01327a31df0032262706e1365114e852dc271779813`
- Sample rate/channels: 44.1 kHz stereo
- Chunk: 352800 samples (8 seconds), 801 STFT frames, overlap 4
- Packed neural input/output: FP32 BTF `[1, 801, 7916]`
- RKNN target/precision: `rk3588`, FP16 weights and compute with FP32 API tensors
- Toolchain validated: RKNN Toolkit/Runtime 2.3.2, RKNPU driver 0.9.8

The source checkpoint is about 913 MB. Do not commit the checkpoint, ONNX files, or
RKNN files to git.

## Why the model is split

The original checkpoint has 228,202,852 parameters. A monolithic ONNX export was
killed by the Linux OOM killer on an 8 GB Orange Pi 5. The deployable bundle keeps
the exact weights and graph structure, apart from the FP16-safe normalization floor
described below, and introduces only natural graph boundaries:

- one band-split model;
- one time and one frequency transformer model for each of six axial layers;
- six mask-estimator groups, ten mel bands each.

Time attention is called with five independent mel bands at a time (12 calls per
layer). Frequency attention is called with 89 independent time frames at a time
(9 calls per layer because `801 = 9 * 89`). This bounds NPU activation memory. By
default all 19 RKNN contexts remain initialized and are reused across audio chunks.
On an 8 GB TV box, `NIGHTINGALE_RKNN_STREAM_COMPONENTS=1` loads one component at
a time and releases it before loading the next to avoid Linux OOM during songs.
With streaming enabled, `NIGHTINGALE_RKNN_PARALLEL_CORES=1` runs independent
transformer slices on three separate RK3588 NPU cores. Band-split and mask heads
remain sequential. This uses more peak memory than single-core streaming.

The band-split export raises its 60 L2-normalization floors from `1e-12` to `1e-4`.
The original floor underflows to zero in FP16, corrupting silent STFT frames and
causing downstream transformer outputs to become non-finite. The new floor is
representable in FP16; verify ONNX/RKNN parity on both silent and non-silent
material before deploying a rebuilt bundle.

## Export and convert

Use a Python 3.10 or 3.11 environment containing the exact `audio-separator`
version used by Nightingale, PyTorch, ONNX, NumPy and PyYAML. Export every component
sequentially:

```bash
python tools/rknn/export_uvr_bundle.py \
  --checkpoint /path/to/mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt \
  --config /path/to/mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956_config.yaml \
  --output-dir /var/tmp/nightingale-uvr-onnx
```

Install the official Rockchip `rknn-toolkit2` wheel in a conversion-only virtual
environment. It is not a Nightingale runtime dependency. Then run:

```bash
python tools/rknn/build_uvr_bundle.py \
  --onnx-dir /var/tmp/nightingale-uvr-onnx \
  --output-dir /var/tmp/nightingale-uvr-rknn
```

Each component sidecar records the source/ONNX/RKNN hashes, shapes, target,
precision and Toolkit version. `build_uvr_bundle.py` verifies hashes before reuse
and writes `manifest.json` only after every component succeeds.

## Install on RK3588

Install the official matching AArch64 `librknnrt.so` in the system library path and
the matching `rknn-toolkit-lite2` wheel in Nightingale's analyzer environment. Copy
the complete bundle directory below Nightingale's `models/audio_separator`
directory as:

```text
models/audio_separator/
  mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.rk3588.fp16/
    manifest.json
    band-split.rknn
    transformer-00-time.rknn
    transformer-00-frequency.rknn
    ...
    mask-50-60.rknn
```

For a development bundle elsewhere, point directly to its manifest or directory:

```bash
export NIGHTINGALE_UVR_RKNN_MODEL=/path/to/bundle/manifest.json
```

Backend selection is controlled by:

```bash
NIGHTINGALE_UVR_BACKEND=auto      # RKNN only when every readiness check passes
NIGHTINGALE_UVR_BACKEND=rknn      # explicit; errors instead of silently falling back
NIGHTINGALE_UVR_BACKEND=existing  # original audio-separator implementation
```

`onnx` is retained as an alias for `existing`. Set `NIGHTINGALE_RKNN_CORE` to
`all`, `0`, `1`, `2`, `0_1`, or `0_1_2` for hardware benchmarking. Set
`NIGHTINGALE_RKNN_PROFILE=1` to log preprocessing, NPU inference, postprocessing
and total time for each chunk.
Streaming components reduces pinned NPU memory at the cost of reloading each
component for every chunk. `OMP_NUM_THREADS=1` further bounds CPU workspaces.

In `auto` mode, a non-finite RKNN output causes the analyzer to restart its
Python process and retry on the existing CPU backend; subsequent songs use CPU
for that session. Explicit `rknn` selection still reports the failure.

## Validation

Run unit tests with a Python environment that has Nightingale's analyzer
dependencies:

```bash
python -m unittest discover -s tools/rknn/tests -v
```

Hardware validation must additionally cover bundle hash validation, initialization
of every persistent context, a non-zero full audio chunk, finite outputs, NPU load,
and comparison against the existing backend on the same audio. Successful RKNN
initialization alone is not proof of NPU inference.

On an RK3588 target with the runtime dependencies installed, run the reproducible
headless validator (it does not access display or audio hardware):

```bash
python tools/rknn/validate_uvr_rknn.py \
  --manifest /path/to/bundle/manifest.json \
  --input-wav /path/to/44.1kHz-stereo-test.wav \
  --reference-npy /path/to/existing-backend-output.npy \
  --iterations 2
```

The JSON report includes init and cold/warm timing, backend phase timing, CPU time,
peak RSS, output shape/RMS/peak/finite/clipping checks, NPU debugfs samples, maximum
core loads and temperature. When a reference is supplied it also reports MAE, MSE,
cosine similarity, SNR, maximum absolute error and sync lag.

RKNN Lite treats four-dimensional Python inputs as NHWC unless told otherwise.
The mask components use the ONNX axis order `[B,T,F,D]`, so the runtime adapter
explicitly marks those buffers as `nchw`; omitting this changes the data order.
Inputs shorter than the static eight-second graph are zero-padded for inference and
cropped back to their original length, which keeps audio-separator's short-track
chunking functional.

# RK3588 Qwen3 forced-aligner backend

Lyrics alignment with the `qwen` alignment backend can run
[Qwen3-ForcedAligner-0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf)
(Apache-2.0) on the NPU. The processor, token-embedding lookup, final RMS norm and
timestamp classifier stay on the host; only the transformer layers are converted.

## Pinned source model

- Model: `Qwen/Qwen3-ForcedAligner-0.6B-hf`, revision
  `c07281df297b9905d24a508279258cccf987a064`
- Audio encoder: 24 layers, attention within 8 s windows (800 mel frames,
  104 audio tokens); a key mask covers a shorter final window.
- Text decoder: 28 causal Qwen3 layers over a static 1024-token sequence. Right
  padding cannot change earlier positions, so one static length serves every chunk.
- RKNN target/precision: `rk3588`, FP16 compute with FP32 API tensors.

The export splits the encoder into three groups of eight layers and the decoder
into seven groups of four layers, so a component never needs more than about
2.3 GB of RAM to export on an 8 GB board. RMS norms are evaluated on the residual
stream divided by 64: Qwen3 activations reach about 7,000, whose squares overflow
FP16. RoPE angles and encoder sinusoids are computed in FP64/FP32 at export time
instead of taking the BF16 checkpoint buffers.

## Export and convert

Export with the analyzer's Python environment (PyTorch and Transformers that
support `Qwen3ASRForTokenClassification`), with the model in the Hugging Face cache:

```bash
python tools/rknn/export_qwen_aligner.py \
  --revision c07281df297b9905d24a508279258cccf987a064 \
  --output-dir /var/tmp/qwen-aligner-onnx
```

Convert in a separate environment containing `rknn-toolkit2==2.3.2` (and
`setuptools<81`, which the toolkit still imports):

```bash
python tools/rknn/build_qwen_aligner.py \
  --onnx-dir /var/tmp/qwen-aligner-onnx \
  --output-dir /var/tmp/qwen-aligner-rknn
```

Each component is exported and converted in its own process. The manifest records
the source model revision, static shapes, ONNX hashes and RKNN hashes.

## Install on RK3588

Copy the bundle into Nightingale's models directory, keeping the Hugging Face
cache entry of the pinned revision (the host side reads its processor, embedding
table and classifier):

```text
models/qwen_aligner/Qwen3-ForcedAligner-0.6B.rk3588.fp16/
  manifest.json
  encoder-00-08.rknn ... encoder-16-24.rknn
  decoder-00-04.rknn ... decoder-24-28.rknn
```

`NIGHTINGALE_QWEN_RKNN_MODEL` may point to another bundle directory or manifest.
With `align_backend` set to `qwen`, LRC-timed songs in the aligner's languages are
aligned on the NPU; without a bundle the Transformers model runs on the host.
Songs without line timings use wav2vec2 on boards with the bundle, because a
whole-song Qwen pass does not fit the static sequence and needs over 5 GB on the CPU.

Validated on an Orange Pi 5 (RKNPU driver 0.9.8, runtime 2.3.2): the split ONNX
graph reproduces the Transformers model's timestamps exactly; on the NPU the
encoder output has cosine similarity 0.99998 and decoder groups 0.9998 against
ONNX. An 8 s encoder window takes about 0.18 s and a 1024-token decoder pass about
3.4 s.
