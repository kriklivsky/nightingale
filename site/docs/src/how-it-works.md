# How It Works

Nightingale's pipeline transforms any audio or video file into a karaoke experience through several stages.

## Pipeline Overview

<pre class="mermaid">
flowchart TD
    A["🎵 Audio or video file"] --> B["LRCLIB synchronized lyrics"]
    B --> |"timed LRC found"| C["Key detection + UVR Karaoke / Demucs"]
    B --> |"no timed LRC"| G["Stop: provide timed LRC"]
    A2["🎼 USDX bundle (.txt / .usdx)"] --> E["Tauri App (Rust + React)"]
    C --> |"Lyricsfile words, or forced word alignment from LRC"| E
    E --> F["🎤 Plays instrumental + synced lyrics\nwith pitch scoring, key/tempo controls,\nmic monitoring, and audio-reactive backgrounds"]
</pre>

USDX bundles bypass LRCLIB lookup and stem separation entirely — the `.txt` is parsed into the same transcript format as analyzed songs, so playback reuses the existing pipeline. See [UltraStar Deluxe](./usdx.md).

## Analyzer Server

The analyzer is a long-lived Python process that Nightingale spawns once on startup and talks to over a token-authenticated loopback TCP socket using newline-delimited JSON (NDJSON). Python and backend startup costs are paid once at boot, after which `analyze` requests stream `progress` events and complete with `done` or `error` messages. This makes back-to-back analyses noticeably faster than the previous per-song subprocess model.

## Caching

Analysis results are cached in your configured data folder (`cache/`) using blake3 file hashes. Re-analysis only happens if the source file changes, if you trigger it manually, or when creating shifted key/tempo variants.

## Hardware Acceleration

The Python analyzer uses PyTorch and auto-detects the best backend:

| Backend | Device | Notes |
|---|---|---|
| CUDA | NVIDIA GPU | Fastest |
| MPS | Apple Silicon | macOS; manual plain-lyrics alignment may fall back to CPU |
| CPU | Any | Slowest but always works |

<br />

The UVR Karaoke model uses ONNX Runtime and enables CUDA acceleration automatically on NVIDIA GPUs, or CoreML on Apple Silicon.

Stem separation remains the expensive stage; time and memory use depend on the model, device, and song length.
