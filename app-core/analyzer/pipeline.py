"""Shared analysis pipeline used by both server.py and analyze.py."""

import json
import os
import subprocess
import tempfile

from gpu import hard_free_gpu, log_vram
from whisper_compat import progress
from key_detect import detect_key
from stems import separate_stems, separate_stems_uvr
from uvr_backend import release_rknn_backend
from align import align_lyrics
from lyricsfile import parse_word_synced


def ffmpeg_bin():
    return os.environ.get("FFMPEG_PATH", "ffmpeg")


def convert_to_mp3(src, dest_mp3):
    subprocess.run(
        [ffmpeg_bin(), "-y", "-i", src, "-c:a", "libmp3lame", "-q:a", "2", "-v", "error", dest_mp3],
        check=True,
    )
    if os.path.isfile(dest_mp3):
        os.remove(src)


def normalize_tempo(tempo):
    try:
        t = float(tempo)
    except (TypeError, ValueError):
        return 1.0
    if t <= 0:
        return 1.0
    return round(t + 1e-8, 1)


def format_tempo(tempo):
    return f"{normalize_tempo(tempo):.1f}"


def sanitize_key(key):
    raw = str(key or "").strip()
    out = []
    for ch in raw:
        if ch.isalnum() or ch in ("#", "b"):
            out.append(ch)
        elif ch in (" ", "-", "_"):
            out.append("_")
    cleaned = "".join(out).strip("_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned or "Unknown"


def copy_stem(src, dest):
    subprocess.run(
        [ffmpeg_bin(), "-y", "-i", src, "-c:a", "copy", "-v", "error", dest],
        check=True,
    )


def separate_and_cache(audio_path, output_dir, file_hash, separator, device, key, tempo, free_gpu_fn=None):
    """Run stem separation or reuse cached stems. Returns the vocals path."""
    key_safe = sanitize_key(key)
    tempo_safe = format_tempo(tempo)
    final_vocals = os.path.join(output_dir, f"{file_hash}_vocals_{key_safe}_{tempo_safe}.mp3")
    final_instrumental = os.path.join(output_dir, f"{file_hash}_instrumental_{key_safe}_{tempo_safe}.mp3")

    if os.path.isfile(final_vocals) and os.path.isfile(final_instrumental):
        progress(50, "Stems already cached, skipping separation")
        return final_vocals

    legacy_mp3_v = os.path.join(output_dir, f"{file_hash}_vocals.mp3")
    legacy_mp3_i = os.path.join(output_dir, f"{file_hash}_instrumental.mp3")
    if os.path.isfile(legacy_mp3_v) and os.path.isfile(legacy_mp3_i):
        progress(50, "Copying legacy mp3 stems to key/tempo variant...")
        copy_stem(legacy_mp3_v, final_vocals)
        copy_stem(legacy_mp3_i, final_instrumental)
        return final_vocals

    for ext in (".ogg", ".wav"):
        legacy_v = os.path.join(output_dir, f"{file_hash}_vocals{ext}")
        legacy_i = os.path.join(output_dir, f"{file_hash}_instrumental{ext}")
        if os.path.isfile(legacy_v) and os.path.isfile(legacy_i):
            progress(50, f"Converting legacy {ext} stems to MP3...")
            convert_to_mp3(legacy_v, final_vocals)
            convert_to_mp3(legacy_i, final_instrumental)
            return final_vocals

    with tempfile.TemporaryDirectory(prefix="nightingale_") as work_dir:
        if separator == "karaoke":
            torch_home = os.environ.get("TORCH_HOME", "")
            models_base = os.path.dirname(torch_home) if torch_home else output_dir
            uvr_models_dir = os.path.join(models_base, "audio_separator")
            os.makedirs(uvr_models_dir, exist_ok=True)
            vp, ip = separate_stems_uvr(audio_path, work_dir, uvr_models_dir)
        else:
            vp, ip = separate_stems(audio_path, work_dir, device)
        progress(51, "Saving stems to cache...")
        convert_to_mp3(vp, final_vocals)
        convert_to_mp3(ip, final_instrumental)

    if free_gpu_fn:
        free_gpu_fn()

    return final_vocals


def run_pipeline(
    audio_path, output_dir, file_hash, device, *,
    model_name="large-v3", separator="karaoke",
    lyrics_path=None, language_override=None,
    pre_align_cleanup=None, free_gpu_fn=None,
    skip_transcription=False,
    skip_separation=False,
    align_lrc_lines=False,
    lrclib_lyricsfile=None,
    duration_secs=None,
):
    """Validate timed lyrics, then detect key and optionally align words/separate stems.

    When ``skip_transcription`` is set, an existing (LRC-provided) transcript is
    kept as-is: only key detection and stem separation run, and the detected key
    is patched into the transcript. When ``skip_separation`` is also set, stem
    separation is skipped too (the song plays over its original mix); only the
    key is detected and stamped onto the provided transcript.
    """
    timed_lines = None
    os.makedirs(output_dir, exist_ok=True)

    transcript_path = os.path.join(output_dir, f"{file_hash}_transcript.json")
    lrc_lines = None
    word_synced = False
    if skip_transcription:
        if not os.path.isfile(transcript_path):
            raise ValueError("Timed lyrics are missing; analysis stopped.")
        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript = json.load(f)
        segments = transcript.get("segments") if isinstance(transcript, dict) else None
        if not isinstance(segments, list) or not any(
            isinstance(segment, dict) and isinstance(segment.get("text"), str)
            and segment["text"].strip() for segment in segments
        ):
            raise ValueError("Timed lyrics have no text; analysis stopped.")
        if align_lrc_lines:
            if not isinstance(duration_secs, (int, float)) or duration_secs <= 0:
                raise ValueError("Song duration is required for timed word alignment.")
            lrc_lines = [segment["text"] for segment in segments if segment["text"].strip()]
            if lrclib_lyricsfile:
                word_segments, lyric_language = parse_word_synced(lrclib_lyricsfile, duration_secs)
                if word_segments:
                    transcript["segments"] = word_segments
                    transcript["language"] = lyric_language or transcript.get("language")
                    transcript["source"] = "lrc"
                    word_synced = True
                    progress(1, "Using LRCLIB word timings")
                elif lyric_language and not language_override:
                    language_override = lyric_language
            timed_lines = [segment for segment in segments if segment["text"].strip()]
    else:
        if not lyrics_path or not os.path.isfile(lyrics_path):
            raise ValueError("Lyrics are missing; provide timed LRC before analysis.")
        with open(lyrics_path, "r", encoding="utf-8") as f:
            lyrics = json.load(f)
        if not isinstance(lyrics, dict) or not any(
            isinstance(line, str) and line.strip() for line in lyrics.get("lines", [])
        ):
            raise ValueError("Lyrics are empty; analysis stopped.")
        if os.path.isfile(transcript_path):
            progress(100, "Already analyzed, skipping")
            return

    progress(2, f"Using device: {device}")

    try:
        log_vram("phase:start")
        detected_key = detect_key(audio_path)
        tempo = 1.0

        vocals_path = None
        if not skip_separation:
            vocals_path = separate_and_cache(
                audio_path, output_dir, file_hash, separator, device,
                key=detected_key,
                tempo=tempo,
                free_gpu_fn=free_gpu_fn,
            )
            log_vram("phase:after_separation")

        if skip_transcription and (not align_lrc_lines or word_synced):
            transcript["key"] = detected_key
            transcript["tempo"] = normalize_tempo(tempo)
            progress(95, "Writing transcript...")
            with open(transcript_path, "w", encoding="utf-8") as f:
                json.dump(transcript, f, ensure_ascii=False, indent=2)
            return
        release_rknn_backend()
        hard_free_gpu("before_alignment")

        transcript = align_lyrics(
            None if lrc_lines is not None else lyrics_path, vocals_path, device,
            model_name=model_name,
            language_override=language_override,
            pre_align_cleanup=pre_align_cleanup,
            timed_lines=timed_lines,
            lyrics_lines=lrc_lines,
        )
        if not transcript.get("segments"):
            raise ValueError("Word alignment produced no timed lyrics; analysis stopped.")
        log_vram("phase:after_align")

        transcript["key"] = detected_key
        transcript["tempo"] = normalize_tempo(tempo)

        progress(95, "Writing transcript...")
        with open(transcript_path, "w", encoding="utf-8") as f:
            json.dump(transcript, f, ensure_ascii=False, indent=2)
    finally:
        hard_free_gpu("pipeline_end")
