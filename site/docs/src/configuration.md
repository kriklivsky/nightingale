# Configuration

Nightingale stores app settings in `~/.nightingale/config.json`.

## Data Storage

During setup, you can choose a custom data folder. Most runtime data lives in that selected folder. In v0.8.0, cache, videos, models, and vendor tools can also move into separate folders from the settings page. `config.json` and `nightingale.log` remain in the default `~/.nightingale` path.

Typical selected data folder layout:

```
<selected-data-folder>/
├── cache/               # Stems, transcripts, lyrics, shifted variants, covers, playable videos
├── songs.db             # Song library and analysis metadata (SQLite)
├── profiles.json        # Player profiles and scores
├── videos/              # Cached Pixabay video backgrounds
├── sounds/              # Sound effects
├── vendor/
│   ├── ffmpeg           # Downloaded ffmpeg binary
│   ├── uv               # Downloaded uv binary
│   ├── python/          # Python 3.10 installed via uv
│   ├── venv/            # Virtual environment with ML packages
│   ├── analyzer/        # Extracted analyzer Python scripts
│   └── .ready           # Marker indicating setup is complete
└── models/
    ├── torch/           # Demucs model cache
    ├── huggingface/     # WhisperX model cache
    └── audio_separator/ # UVR Karaoke model cache
```

## Video Backgrounds

Pixabay video backgrounds use the [Pixabay API](https://pixabay.com/api/docs/). In development, create a `.env` file at the project root with:

```
PIXABAY_API_KEY=your_key_here
```

## Theme

Toggle between dark and light themes from the sidebar. The theme preference is saved in the config.

![White theme](images/white-theme.png)

## Notable Settings

`config.json` is written by the app — you'll usually change these from **Settings** rather than by editing the file directly. Settings are grouped into **General**, **Playback**, and **Analysis** tabs. A few keys worth knowing:

| Key | Purpose |
|---|---|
| `asr_engine` | Legacy setting retained in existing configs; automatic analysis no longer uses ASR. |
| `align_backend` | Forced-alignment backend for manually provided plain lyrics: `whisperx`, `ctc`, or `qwen`. Timed LRCLIB lyrics do not need alignment. |
| `separator` | Stem separation model: `karaoke` (UVR, default) or `demucs`. |
| `vocal_detection_threshold_pct` | RMS threshold (fraction of the loudest window, `0.0`–`1.0`, default `0.15`) that marks where vocals start and end. Lower values keep more quiet intros/outros and soft singing; higher values trim more silence. Shown in Settings as **Vocal detection sensitivity** (0–60%). |
| `whisper_model` | Legacy ASR option, unused by automatic analysis. |
| `beam_size` / `batch_size` | Legacy ASR options, unused by automatic analysis. |
| `mic_monitor_gain` | Live monitor gain when mic monitoring is on. Range `0.0`–`2.0` (slider shown as 0–200%). Configs from older builds that used `mic_mirror_gain` are read transparently and migrated on next save. |
| `mic_latency_compensation_sec` | Speaker-to-mic latency compensation for pitch scoring. Tune manually or use the Settings latency test. |
| `mic_active` / `mic_monitoring` / `preferred_mic` | Microphone state and the device chosen for scoring + monitoring. Older `mic_mirroring` configs are accepted and migrated on next save. |
| `playback_mode` | `classic` replaces the menu with playback; `session` opens playback in a dedicated desktop window or browser tab so the menu can manage the queue. |
| `lyrics_vertical_position` / `lyrics_horizontal_position` | Playback lyrics placement. Vertical: `top`, `center`, `bottom`; horizontal: `left`, `center`, `right`. |
| `lyrics_scale` / `pitch_graph_scale` | Independent playback display scales from `0.5` to `2.5` (50–250%, default `1.0`). |
| `auto_analyze` | When `true`, scans automatically queue every unanalyzed song after they finish. |
| `cache_paths` | Optional per-folder overrides for `songs`, `videos`, `models`, and `vendor`. Use Settings to move them so existing contents migrate safely. |
| `last_video_flavor` | Index of the last-used Pixabay video flavor (Nature, Underwater, Space, City, Countryside). |
| `last_theme` | Index of the last-used playback background (shaders → video → source). |
| `language_overrides` | Per-song language override for manually aligned plain lyrics, keyed by song hash. |
| `data_path` | Selected data folder root. Set during first-run setup. |
