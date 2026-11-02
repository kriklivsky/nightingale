"""Lyrics alignment: align pre-fetched lyrics text to vocals audio using WhisperX."""

import itertools
import json
import math
import os
import re

import numpy as np

import cjk
from audio import detect_vocal_region, silent_gaps
from gpu import gpu_model
from language import detect_language_multiwindow
from whisper_compat import progress, align_device_for, compute_type_for, align_with_fallback, get_align_backend, load_whisper_model


def align_lyrics(
    lyrics_path: str | None,
    vocals_path: str,
    device: str,
    model_name: str = "large-v3",
    language_override: str | None = None,
    whisper_model=None,
    pre_align_cleanup=None,
    lyrics_lines: list[str] | None = None,
    timed_lines: list[dict] | None = None,
    mix_path: str | None = None,
) -> dict:
    """Align pre-existing lyrics to vocals audio using WhisperX.

    Steps:
      1. Load lyrics text from JSON
      2. Load vocals audio and detect vocal region via RMS
      3. Detect language
      4. Probe multiple start offsets to find where vocals actually begin
      5. Run final forced alignment from the best offset
      6. Map aligned word timestamps back to original lyric lines
    """
    import whisperx

    progress(55, "Loading lyrics...")
    lyrics_data = {}
    if lyrics_lines is None:
        if lyrics_path is None:
            raise ValueError("Lyrics are missing; analysis stopped.")
        with open(lyrics_path, "r", encoding="utf-8") as f:
            lyrics_data = json.load(f)
        lines = lyrics_data.get("lines", [])
    else:
        lines = lyrics_lines
    print(f"[nightingale:LOG] Lyrics loaded: {len(lines)} lines", flush=True)
    windows = _line_windows(
        timed_lines if timed_lines is not None else lyrics_data.get("windows"),
        len(lines),
    )

    # {base|note} markup puts a note above a word; strip it here so the
    # aligners and displayed text only see the base, and keep the spans.
    clean_lines: list[str] = []
    line_spans: list[list[tuple[int, int, str]]] = []
    line_windows: list[tuple[float, float]] | None = [] if windows is not None else None
    for index, line in enumerate(lines):
        text = line.strip() if isinstance(line, str) else str(line).strip()
        text, spans = cjk.parse_reading_markup(text)
        if text:
            clean_lines.append(text)
            line_spans.append(spans)
            if line_windows is not None and windows is not None:
                line_windows.append(windows[index])
    if line_windows is not None:
        print(
            f"[nightingale:LOG] Line timings provided: aligning words within "
            f"{len(line_windows)} line windows",
            flush=True,
        )
    if any(line_spans):
        print(
            f"[nightingale:LOG] Lyric notes: {sum(len(s) for s in line_spans)}",
            flush=True,
        )

    audio = whisperx.load_audio(vocals_path)
    duration_secs = len(audio) / 16000
    print(f"[nightingale:LOG] Vocals audio loaded: {len(audio)} samples ({duration_secs:.1f}s)", flush=True)

    progress(56, "Detecting vocal regions...")
    vocal_start, vocal_end = detect_vocal_region(audio)

    a_device = align_device_for(device)
    c_type = compute_type_for(device)

    if language_override and language_override.strip().lower() not in ("unknown", "und", ""):
        language = language_override
        print(f"[nightingale:LOG] Using language override: '{language}'", flush=True)
        progress(59, f"Language override: {language}")
    else:
        progress(58, "Detecting language...")
        with gpu_model(f"whisper:{model_name}:lang_detect") as held:
            model = load_whisper_model(
                model_name, a_device, c_type, task="transcribe",
            )
            held.append(model)
            language = detect_language_multiwindow(model, audio)
        del model
        print(f"[nightingale:LOG] Detected language: '{language}'", flush=True)
        progress(59, f"Detected language: {language}")

    progress(80, f"Final alignment from {vocal_start:.1f}s...")

    import qwen_align
    if get_align_backend() == "qwen" and qwen_align.is_supported(language):
        qwen_segments = _align_lyrics_qwen(
            clean_lines, line_spans, audio, language, vocal_start, vocal_end, pre_align_cleanup,
            line_windows, mix_path,
        )
        if qwen_segments is not None:
            if line_windows is None:
                _trim_words_to_vocals(qwen_segments, audio)
            _separate_lines(qwen_segments)
            progress(90, f"Alignment complete: {len(qwen_segments)} segments, lang={language}")
            if qwen_segments:
                print(f"[nightingale:LOG] First segment: '{qwen_segments[0]['text'][:100]}'", flush=True)
                print(f"[nightingale:LOG] Last segment: '{qwen_segments[-1]['text'][:100]}'", flush=True)
            return {"language": language, "segments": qwen_segments, "source": "lyrics"}
        print(
            "[nightingale:LOG] Qwen lyrics alignment unavailable; falling back to wav2vec2 path",
            flush=True,
        )

    line_token_pairs: list[list[tuple[str, str]]] | None = None
    if cjk.is_cjk(language):
        line_token_pairs = [
            cjk.tokenize_for_alignment(line, language, spans)
            for line, spans in zip(clean_lines, line_spans)
        ]
        cleaned_lines = ["".join(r for _, r in toks) for toks in line_token_pairs]
        full_text = "".join(cleaned_lines)
        segment_texts = cleaned_lines
        print(
            f"[nightingale:LOG] CJK alignment input: {len(full_text)} chars across "
            f"{sum(1 for c in cleaned_lines if c)} non-empty lines (lang={language}, "
            f"model={cjk.align_model_for(language) or 'default'})",
            flush=True,
        )
    else:
        full_text = " ".join(clean_lines)
        segment_texts = clean_lines

    if line_windows is not None:
        raw_segments = _window_segments(segment_texts, line_windows, duration_secs)
        print(
            f"[nightingale:LOG] Aligning {len(raw_segments)} timed lyric lines separately",
            flush=True,
        )
    else:
        raw_segments = [{"text": full_text, "start": vocal_start, "end": vocal_end}]

    align_result = align_with_fallback(
        raw_segments, audio, cjk.align_lang_code(language), a_device, pre_align_cleanup,
        model_name=cjk.align_model_for(language),
    )
    if line_windows is not None:
        line_segments = _segments_per_line(align_result, segment_texts)
        if not cjk.is_cjk(language):
            _realign_contested_lines(
                line_segments, segment_texts, line_windows, audio, language, a_device,
                pre_align_cleanup,
            )
        align_result = {"segments": line_segments}

    if cjk.is_cjk(language):
        segments = _map_chars_to_lines_cjk(
            align_result, clean_lines, line_token_pairs, line_spans, language, line_windows,
        )
    else:
        segments = _map_words_to_lines(
            align_result, clean_lines, line_spans, language, line_windows,
        )

    _trim_words_to_vocals(segments, audio)
    _separate_lines(segments)

    progress(90, f"Alignment complete: {len(segments)} segments, lang={language}")
    if segments:
        print(f"[nightingale:LOG] First segment: '{segments[0]['text'][:100]}'", flush=True)
        print(f"[nightingale:LOG] Last segment: '{segments[-1]['text'][:100]}'", flush=True)

    return {"language": language, "segments": segments, "source": "lyrics"}

# LRC line timestamps are often a little early or late, so each line is aligned
# against its window widened by this much on both sides.
WINDOW_PAD_SECONDS = 0.5
# Longest stretch of contested lines re-aligned as one passage.
MAX_JOINT_ALIGN_SECONDS = 30.0

# Qwen chunking: one chunk holds lines spanning up to CHUNK_LRC_SECONDS of LRC
# time and is searched SEARCH_SECONDS around them once the local LRC offset is
# known, WIDE_SEARCH_SECONDS before that or after a chunk found nothing.
CHUNK_LRC_SECONDS = 20.0
SEARCH_SECONDS = 5.0
WIDE_SEARCH_SECONDS = 10.0
MAX_CHUNK_SECONDS = 40.0
ENERGY_FRAME_SECONDS = 0.02
# Confidence of a line is the aligner's mean probability for its word starts;
# misaligned text (a choir drowned in the mix, words that are not there)
# scores low. A line is kept within CLOSE_DRIFT_SECONDS of its expected offset
# from MIN_LINE_CONFIDENCE, within LINE_DRIFT_SECONDS from SURE_LINE_CONFIDENCE.
# The expected offset jumps (a cut in a music video) only when JUMP_LINES lines
# agree on the new one with a mean confidence of SURE_LINE_CONFIDENCE.
MIN_LINE_CONFIDENCE = 0.2
SURE_LINE_CONFIDENCE = 0.35
CLOSE_DRIFT_SECONDS = 1.5
JUMP_LINES = 2
# A gap this long between one word's end and the next word's start makes the
# line suspect; a long continuously sung word is not a gap.
MAX_WORD_GAP_SECONDS = 4.0
# Singing time of a line: lead-in plus time per syllable. An LRC line counts
# for at most LRC_LINE_SPAN_FACTOR times that, so a timestamp far from the
# singing (a first line stamped at 0:00) cannot stretch a chunk.
LINE_LEAD_SECONDS = 0.5
SECONDS_PER_SYLLABLE = 0.3
LRC_LINE_SPAN_FACTOR = 2.0
SYLLABLE_PATTERN = re.compile(
    r"[aeiouyàáâãäåæèéêëìíîïòóôõöøœùúûüýÿаеёиоуыэюя]|[぀-ヿ㐀-鿿가-힯]",
    re.IGNORECASE,
)
# Vocal-stem frames below this fraction of the song's 95th-percentile level
# count as silent; lines whose window is mostly silent are aligned on the mix.
SILENT_VOCAL_RATIO = 0.08
MIX_FALLBACK_SILENT_FRACTION = 0.6
LINE_DRIFT_SECONDS = 3.0
# Neighbours whose offsets differ by less than this are interpolated between;
# a larger step is a cut in the recording, placed at the longest LRC pause.
OFFSET_STEP_SECONDS = 1.0
REPAIR_PAD_SECONDS = 1.0
# An estimated line starts at the first sung moment of its window when the
# stem is silent for longer than this at its LRC time.
LATE_ENTRY_SECONDS = 1.0
MIN_WORD_SECONDS = 0.081


def _line_windows(raw, line_count: int) -> list[tuple[float, float]] | None:
    """Validate the lyrics file's optional per-line ``{start, end}`` windows.

    Returns ``None`` (plain whole-song alignment) when absent or malformed.
    """
    if raw is None:
        return None
    if not isinstance(raw, list) or len(raw) != line_count:
        print("[nightingale:LOG] Ignoring line timings: they don't match the lyric lines", flush=True)
        return None
    windows: list[tuple[float, float]] = []
    for window in raw:
        try:
            start, end = float(window["start"]), float(window["end"])
        except (TypeError, KeyError, ValueError):
            print("[nightingale:LOG] Ignoring line timings: malformed window", flush=True)
            return None
        if not (math.isfinite(start) and math.isfinite(end)) or start < 0 or end <= start:
            print("[nightingale:LOG] Ignoring line timings: invalid window", flush=True)
            return None
        windows.append((start, end))
    return windows


def _window_segments(
    texts: list[str], windows: list[tuple[float, float]], duration: float,
) -> list[dict]:
    """One alignment segment per non-empty line, spanning its padded window."""
    return [
        {
            "text": text,
            "start": max(0.0, start - WINDOW_PAD_SECONDS),
            "end": min(duration, end + WINDOW_PAD_SECONDS),
        }
        for text, (start, end) in zip(texts, windows)
        if text
    ]


def _hold_words_in_window(words: list[dict], window_end: float) -> None:
    """Keep each word lit until the next one starts, and the line's last word
    until its LRC end.

    CTC aligners often end a word right after its onset, which makes the player
    drop a line long before it is sung out. Holds that cross a long vocal
    silence are cut back afterwards by :func:`_trim_words_to_vocals`.
    """
    for word, following in zip(words, words[1:]):
        word["end"] = round(max(word["end"], following["start"]), 3)
    if words:
        words[-1]["end"] = round(max(words[-1]["end"], window_end), 3)


def _chars_per_window_line(align_result: dict, counts: list[int]) -> list[list[dict]]:
    """Aligned chars of each line when every line was its own alignment segment.

    A segment the aligner could not place comes back with no words, so lines
    are matched to output segments one by one instead of slicing a flat char
    stream, which would shift every later line. ``counts`` is each line's
    alignment-char count; a line whose segment failed gets no chars.
    """
    segments = align_result.get("segments", [])
    lines: list[list[dict]] = []
    for index, count in enumerate(counts):
        chars = (
            _collect_aligned({"segments": [segments[index]]})[:count]
            if index < len(segments)
            else []
        )
        lines.append(chars)
    return lines


def _segments_per_line(align_result: dict, texts: list[str]) -> list[dict]:
    """Regroup aligner output into exactly one segment per input line.

    WhisperX splits every input segment into sentences ("ке паса? Не вздумай")
    and may merge or drop some of them, so output segment ``i`` is not line
    ``i``. Output segments are consumed in order; each one joins the line whose
    whitespace-free text it continues.
    """
    outputs = align_result.get("segments", [])
    grouped: list[dict] = []
    cursor = 0
    for text in texts:
        line = "".join(text.split())
        words: list[dict] = []
        offset = 0
        while line and cursor < len(outputs):
            piece = "".join(str(outputs[cursor].get("text", "")).split())
            found = line.find(piece, offset)
            if found < 0:
                break
            words.extend(outputs[cursor].get("words") or [])
            offset = found + len(piece)
            cursor += 1
        grouped.append({"text": text, "words": words})
    return grouped


def _timed_span(words: list[dict]) -> tuple[float, float] | None:
    starts = [w["start"] for w in words if w.get("start") is not None]
    ends = [w["end"] for w in words if w.get("end") is not None]
    return (min(starts), max(ends)) if starts and ends else None


def _contested_runs(
    line_segments: list[dict], windows: list[tuple[float, float]],
) -> list[list[int]]:
    """Runs of adjacent lines whose separately aligned words overlap in time.

    Padded windows overlap, and CTC stretches a line's first word back into the
    previous line's singing, so both lines claim the same audio.
    """
    runs: list[list[int]] = []
    for index in range(1, len(line_segments)):
        prev = _timed_span(line_segments[index - 1]["words"])
        cur = _timed_span(line_segments[index]["words"])
        if prev is None or cur is None or cur[0] >= prev[1]:
            continue
        if (
            runs
            and runs[-1][-1] == index - 1
            and windows[index][1] - windows[runs[-1][0]][0] <= MAX_JOINT_ALIGN_SECONDS
        ):
            runs[-1].append(index)
        else:
            runs.append([index - 1, index])
    return runs


def _realign_contested_lines(
    line_segments: list[dict],
    texts: list[str],
    windows: list[tuple[float, float]],
    audio,
    language: str,
    device: str,
    pre_align_cleanup=None,
) -> None:
    """Align each contested run of lines as one passage and split its words back.

    A single CTC pass places the words of neighbouring lines strictly in order,
    so the boundary between them follows the audio instead of the padding.
    """
    runs = _contested_runs(line_segments, windows)
    if not runs:
        return
    duration = len(audio) / 16000
    passages = [
        {
            "text": " ".join(texts[index] for index in run),
            "start": max(0.0, windows[run[0]][0] - WINDOW_PAD_SECONDS),
            "end": min(duration, windows[run[-1]][1] + WINDOW_PAD_SECONDS),
        }
        for run in runs
    ]
    result = align_with_fallback(
        passages, audio, cjk.align_lang_code(language), device, pre_align_cleanup,
        model_name=cjk.align_model_for(language),
    )
    realigned = 0
    for run, passage in zip(runs, _segments_per_line(result, [p["text"] for p in passages])):
        words = [w for w in passage["words"] if str(w.get("word", "")).strip()]
        counts = [len(texts[index].split()) for index in run]
        if len(words) != sum(counts):
            continue
        for index, count in zip(run, counts):
            line_segments[index]["words"], words = words[:count], words[count:]
        realigned += len(run)
    print(
        f"[nightingale:LOG] Jointly re-aligned {realigned} lines in {len(runs)} contested runs",
        flush=True,
    )


def _separate_lines(segments: list[dict]) -> None:
    """Make consecutive lines strictly ordered without overlap.

    A line's held last word runs to its LRC end, which can pass the aligned
    onset of the next line; the earlier line is cut at that onset.
    """
    for prev, cur in zip(segments, segments[1:]):
        boundary = max(cur["start"], prev["start"])
        for w in prev["words"]:
            w["start"] = min(w["start"], boundary)
            w["end"] = max(w["start"], min(w["end"], boundary))
        for w in cur["words"]:
            w["start"] = max(w["start"], boundary)
            w["end"] = max(w["end"], w["start"])
        prev["end"] = max(prev["start"], min(prev["end"], boundary))
        cur["start"] = boundary
        cur["end"] = max(cur["end"], boundary)


def _trim_words_to_vocals(segments: list[dict], audio) -> None:
    """Shrink words that span a long vocal silence to their longest sung part.

    Aligners fill instrumental breaks by stretching the neighbouring word across
    them (風 highlighted through a 40 s interlude). Words lying entirely inside a
    silence are left alone: there is no sung part to move them to.
    """
    gaps = silent_gaps(audio)
    if not gaps:
        return
    trimmed = 0
    for seg in segments:
        words = seg.get("words") or []
        for w in words:
            start, end = w.get("start"), w.get("end")
            if start is None or end is None:
                continue
            pieces: list[tuple[float, float]] = []
            cursor = start
            for g_start, g_end in gaps:
                if g_end <= cursor or g_start >= end:
                    continue
                if g_start > cursor:
                    pieces.append((cursor, g_start))
                cursor = max(cursor, g_end)
            if cursor < end:
                pieces.append((cursor, end))
            if not pieces or pieces == [(start, end)]:
                continue
            best_start, best_end = max(pieces, key=lambda p: p[1] - p[0])
            w["start"] = round(best_start, 3)
            w["end"] = round(best_end, 3)
            trimmed += 1
        if words:
            seg["start"] = words[0]["start"]
            seg["end"] = max(seg["start"], words[-1]["end"])
    if trimmed:
        print(f"[nightingale:LOG] Trimmed {trimmed} words stretched over vocal silences", flush=True)


def _normalize(word: str) -> str:
    return re.sub(r"[^\w]", "", word).lower()


def _collect_aligned(align_result: dict) -> list[dict]:
    """Extract every aligned word in input-text order, including NaN-timestamp ones.

    WhisperX iterates input characters in order and groups them by a
    monotonically-increasing word index, so the resulting word list preserves
    lyric order. Words the CTC backtrack could not place are emitted without
    "start"/"end" keys (whisperx/alignment.py l.343-350); we keep those in the
    stream as None-timestamp entries so the line-mapper can treat them as
    missing rather than silently consuming a later occurrence's timestamp.
    """
    out: list[dict] = []
    for seg in align_result.get("segments", []):
        for w in seg.get("words", []):
            text = w.get("word", "").strip()
            if not text:
                continue
            out.append({
                "word": text,
                "norm": _normalize(text),
                "start": w.get("start"),
                "end": w.get("end"),
                "score": w.get("score"),
            })
    return out


def _map_chars_to_lines_cjk(
    align_result: dict,
    original_lines: list[str],
    line_token_pairs: list[list[tuple[str, str]]],
    line_spans: list[list[tuple[int, int, str]]],
    language: str,
    line_windows: list[tuple[float, float]] | None = None,
) -> list[dict]:
    """Map per-character whisperx timestamps onto fugashi/jieba tokens.

    ``line_token_pairs[i]`` is the per-token (display_surface,
    alignment_text) decomposition of ``original_lines[i]``. The aligner saw
    the concatenation of every alignment_text and emitted one timed entry
    per char in input order; we slice that stream per line by the line's
    total alignment-char count, then reattribute char timings onto tokens
    using each token's alignment-text length (which may differ from the
    surface length, e.g. when surface=kanji and alignment=hiragana).
    """
    aligned = _collect_aligned(align_result)
    timed_count = sum(1 for a in aligned if a["start"] is not None and a["end"] is not None)
    print(
        f"[nightingale:LOG] CJK alignment: {len(aligned)} chars emitted "
        f"({timed_count} timed, {len(aligned) - timed_count} NaN)",
        flush=True,
    )

    segments: list[dict] = []
    cursor = 0
    skipped_empty = 0
    window_chars = (
        _chars_per_window_line(
            align_result, [sum(len(r) for _, r in pairs) for pairs in line_token_pairs],
        )
        if line_windows is not None
        else None
    )

    for index, (original, token_pairs, spans) in enumerate(
        zip(original_lines, line_token_pairs, line_spans)
    ):
        n = sum(len(r) for _, r in token_pairs)
        if n == 0:
            skipped_empty += 1
            continue

        if window_chars is not None:
            slice_chars = window_chars[index]
        else:
            slice_chars = aligned[cursor:cursor + n]
            cursor += len(slice_chars)

        if not token_pairs:
            continue
        surfaces = [s for s, _ in token_pairs]
        lengths = [len(r) for _, r in token_pairs]

        fb_start = next((c["start"] for c in slice_chars if c["start"] is not None), None)
        fb_end = next((c["end"] for c in reversed(slice_chars) if c["end"] is not None), None)
        if line_windows is not None and (fb_start is None or fb_end is None):
            # Nothing in this line aligned: spread it over its LRC window.
            fb_start, fb_end = line_windows[index]

        entries = cjk.attribute_chars_to_tokens(
            surfaces, slice_chars,
            fallback_start=fb_start,
            fallback_end=fb_end,
            cleaned_lengths=lengths,
        )
        entries = cjk.merge_punct(entries)

        valid = [e for e in entries if e.get("start") is not None and e.get("end") is not None]
        if not valid:
            continue

        for e in valid:
            e["start"] = round(e["start"], 3)
            e["end"] = round(e["end"], 3)
            if e["end"] < e["start"]:
                e["end"] = e["start"]
            if "score" in e and e["score"] is not None:
                e["score"] = round(e["score"], 3)

        cjk.attach_reading(valid, language, line=original, spans=spans)
        if line_windows is not None:
            _hold_words_in_window(valid, line_windows[index][1])

        seg_start = valid[0]["start"]
        seg_end = valid[-1]["end"]
        if seg_end < seg_start:
            seg_end = seg_start

        segments.append({
            "text": original,
            "start": seg_start,
            "end": seg_end,
            "words": valid,
        })

    total_words = sum(len(s["words"]) for s in segments)
    print(
        f"[nightingale:LOG] CJK lyrics alignment: {len(segments)} lines, "
        f"{total_words} tokens ({skipped_empty} empty lines skipped)",
        flush=True,
    )

    return segments


def _align_lyrics_qwen(
    clean_lines: list[str],
    line_spans: list[list[tuple[int, int, str]]],
    audio,
    language: str,
    vocal_start: float,
    vocal_end: float,
    pre_align_cleanup=None,
    line_windows: list[tuple[float, float]] | None = None,
    mix_path: str | None = None,
) -> list[dict] | None:
    """Align lyrics with Qwen3-ForcedAligner and map tokens back to lines.

    Without LRC windows, the whole vocal region is aligned in one pass against
    the newline-joined lyrics and the flat token stream is sliced onto lines.
    With windows, lines are aligned in chunks of several verses (see
    :func:`_align_chunks_qwen`). Returns ``None`` on any qwen failure so the
    caller falls back to the wav2vec2 path.
    """
    import qwen_align

    if line_windows is not None:
        try:
            aligner = qwen_align.open_chunk_aligner(language)
        except qwen_align.QwenUnsupportedError as e:
            print(f"[nightingale:LOG] Qwen aligner unsupported: {e}", flush=True)
            return None
        except Exception as e:
            print(f"[nightingale:LOG] Qwen aligner failed to load: {e}", flush=True)
            return None
        try:
            return _align_chunks_qwen(
                aligner, clean_lines, line_spans, audio, language, line_windows, mix_path,
            )
        except Exception as e:
            print(f"[nightingale:LOG] Qwen chunked alignment failed: {e}; using wav2vec2", flush=True)
            return None
        finally:
            aligner.close()

    import qwen_rknn

    try:
        qwen_rknn.resolve_bundle(os.path.dirname(os.environ.get("TORCH_HOME", "")))
        print(
            "[nightingale:LOG] Whole-song Qwen alignment needs line timings on this device; "
            "using wav2vec2",
            flush=True,
        )
        return None
    except qwen_rknn.AlignerUnavailable:
        pass

    full_text = "\n".join(clean_lines)
    raw_segments = [{"text": full_text, "start": vocal_start, "end": vocal_end}]
    try:
        result = qwen_align.qwen_align_with_cpu_fallback(
            raw_segments, audio, language, pre_align_cleanup,
        )
    except qwen_align.QwenUnsupportedError as e:
        print(f"[nightingale:LOG] Qwen aligner unsupported: {e}", flush=True)
        return None
    except Exception as e:
        print(f"[nightingale:LOG] Qwen aligner failed: {e}", flush=True)
        return None

    segments = _map_qwen_units_to_lines(result, clean_lines, line_spans, language, line_windows)
    if not segments:
        return None

    total_words = sum(len(s["words"]) for s in segments)
    print(
        f"[nightingale:LOG] Qwen lyrics alignment: {len(segments)} lines, {total_words} tokens",
        flush=True,
    )
    return segments


def _vocal_energy(audio) -> np.ndarray:
    hop = int(ENERGY_FRAME_SECONDS * 16000)
    frames = np.asarray(audio[: len(audio) // hop * hop], dtype=np.float32).reshape(-1, hop)
    if not len(frames):
        return np.empty(0, dtype=np.float32)
    rms = np.sqrt(np.mean(frames**2, axis=1))
    kernel = np.ones(5) / 5
    padding = len(kernel) // 2
    return np.convolve(np.pad(rms, padding, mode="edge"), kernel, mode="valid")


# LRC taken from another release of the song (a music video with a longer
# intro, a live cut) is moved by the shift under which its lines cover the
# loudest vocal-stem frames. An LRC line lasts until the next one, so each span
# is capped by its word count; lines moved outside the recording score as
# silence. Vocal level is z-scored dB at LRC_SHIFT_STEP_SECONDS resolution.
LRC_SHIFT_STEP_SECONDS = 0.1
LRC_SECONDS_PER_WORD = 0.35
LRC_LINE_LEAD_SECONDS = 0.5
MAX_LRC_LINE_SECONDS = 6.0


def estimate_lrc_shift(vocals_path: str, lines: list[dict], max_shift: float) -> float:
    """Seconds to add to the LRC times of ``lines`` for this recording."""
    import whisperx

    energy = _vocal_energy(whisperx.load_audio(vocals_path))
    step = int(round(LRC_SHIFT_STEP_SECONDS / ENERGY_FRAME_SECONDS))
    if not lines or len(energy) < step or not np.all(np.isfinite(energy)):
        return 0.0
    energy = energy[: len(energy) // step * step].reshape(-1, step).mean(axis=1)
    level = 20 * np.log10(energy + 1e-5)
    deviation = float(np.std(level))
    if deviation <= np.finfo(np.float32).eps:
        return 0.0
    level = np.clip((level - np.median(level)) / (deviation + 1e-6), -3.0, 3.0)
    reach = int(max_shift / LRC_SHIFT_STEP_SECONDS)
    totals = np.concatenate([[0.0], np.cumsum(level)])
    silence = float(level.min())
    spans = []
    for line in lines:
        start = float(line["start"])
        end = min(
            float(line["end"]),
            start + MAX_LRC_LINE_SECONDS,
            start + LRC_LINE_LEAD_SECONDS + LRC_SECONDS_PER_WORD * len(str(line.get("text", "")).split()),
        )
        first = int(start / LRC_SHIFT_STEP_SECONDS)
        spans.append((first, max(first + 1, int(end / LRC_SHIFT_STEP_SECONDS))))

    def score(shift: int) -> float:
        total = 0.0
        for first, last in spans:
            lo = min(max(first + shift, 0), len(level))
            hi = min(max(last + shift, 0), len(level))
            missing = last - first - (hi - lo)
            total += totals[hi] - totals[lo] + missing * silence
        return float(total)

    best_score, best_shift = score(0), 0
    for shift in range(-reach, reach + 1):
        candidate = score(shift)
        tied = math.isclose(candidate, best_score, rel_tol=1e-9, abs_tol=1e-9)
        if (tied and abs(shift) < abs(best_shift)) or (not tied and candidate > best_score):
            best_score, best_shift = candidate, shift
    return best_shift * LRC_SHIFT_STEP_SECONDS


def shift_lines(lines: list[dict], shift: float, duration: float) -> list[dict]:
    """Copies of ``lines`` moved by ``shift`` seconds; lines that end up outside
    the recording are dropped and the rest are clamped to it."""
    moved = []
    for line in lines:
        start, end = float(line["start"]) + shift, float(line["end"]) + shift
        if end <= 0 or start >= duration:
            continue
        line = dict(line, start=max(0.0, start), end=min(duration, end))
        if isinstance(line.get("words"), list):
            line["words"] = [
                dict(word, **{key: min(duration, max(0.0, float(word[key]) + shift))
                              for key in ("start", "end") if isinstance(word.get(key), (int, float))})
                for word in line["words"] if isinstance(word, dict)
            ]
        moved.append(line)
    return moved


def _syllables(text: str) -> int:
    return max(1, len(SYLLABLE_PATTERN.findall(text)))


def _sung_seconds(text: str) -> float:
    return LINE_LEAD_SECONDS + SECONDS_PER_SYLLABLE * _syllables(text)


def _line_confidence(segment: dict) -> float:
    return float(np.mean([word.get("score", 0.0) for word in segment["words"]]))


def _spread_words(text: str, start: float, end: float, language: str) -> list[dict]:
    """The line's words over ``start``..``end`` in proportion to their
    syllables, marked as estimated (CJK lines stay one unit)."""
    words = [text] if cjk.is_cjk(language) else text.split() or [text]
    weights = [_syllables(word) for word in words]
    total = sum(weights)
    spread = []
    elapsed = 0
    for word, weight in zip(words, weights):
        spread.append({
            "word": word,
            "start": round(start + (end - start) * elapsed / total, 3),
            "end": round(start + (end - start) * (elapsed + weight) / total, 3),
            "estimated": True,
        })
        elapsed += weight
    return spread


def _align_chunks_qwen(
    aligner,
    clean_lines: list[str],
    line_spans: list[list[tuple[int, int, str]]],
    audio,
    language: str,
    windows: list[tuple[float, float]],
    mix_path: str | None = None,
) -> list[dict]:
    """Align LRC-timed lines a few verses at a time.

    LRC timestamps only seed the search: they are often a second or more off
    the recording, shift by several seconds where a music video cuts or extends
    a section, and some are plainly wrong. Each chunk is searched around its
    LRC time moved by the offset of the lines aligned just before it, starting
    after the last aligned word; its last line is aligned again with the next
    chunk, so a chunk end cannot squeeze it. A line is kept when the aligner
    is confident about its words and it starts near the expected offset; the
    offset jumps only when several lines agree on the new one; initial anchors
    can come from separate chunks.
    Lines whose vocal stem is mostly silent (a choir or backing vocals
    the separator put in the instrumental) are aligned against the original
    mix, and the other source is tried when a chunk is not fully confident.
    Lines still missing are aligned again between their aligned neighbours;
    the rest are spread over their LRC time moved by the neighbours' offset
    and marked as estimated.
    """
    duration = len(audio) / 16000
    energy = _vocal_energy(audio)
    silent = energy < np.percentile(energy, 95) * SILENT_VOCAL_RATIO
    mix = None
    count = len(clean_lines)
    lrc_start = [window[0] for window in windows]
    lrc_end = [
        min(window[1], window[0] + LRC_LINE_SPAN_FACTOR * _sung_seconds(text))
        for window, text in zip(windows, clean_lines)
    ]
    results: list[dict | None] = [None] * count
    from_mix = [False] * count
    pending: dict[int, tuple[dict, bool]] = {}
    successful_calls = 0

    def offset_of(index: int) -> float:
        return results[index]["start"] - lrc_start[index]

    def frames(start: float, end: float) -> np.ndarray:
        first_frame = max(0, int(start / ENERGY_FRAME_SECONDS))
        return silent[first_frame : max(first_frame, int(end / ENERGY_FRAME_SECONDS))]

    def unvoiced(index: int, offset: float) -> bool:
        window = frames(lrc_start[index] + offset, lrc_end[index] + offset)
        return bool(mix_path) and len(window) > 0 and window.mean() > MIX_FALLBACK_SILENT_FRACTION

    def source(on_mix: bool):
        nonlocal mix
        if not on_mix:
            return audio
        if mix is None:
            import whisperx

            mix = whisperx.load_audio(mix_path)
        return mix

    def align_span(first: int, last: int, start: float, end: float, on_mix: bool) -> list[dict | None]:
        nonlocal successful_calls
        try:
            tokens = aligner.align(
                source(on_mix)[int(start * 16000) : int(end * 16000)],
                "\n".join(clean_lines[first : last + 1]),
                language,
            )
            successful_calls += 1
        except Exception as e:
            print(f"[nightingale:LOG] Qwen chunk {first + 1}-{last + 1} failed: {e}", flush=True)
            tokens = []
        words = [
            {
                "word": t["text"],
                "start": round(min(t["start_time"] + start, end), 3),
                "end": round(min(t["end_time"] + start, end), 3),
                "score": t.get("confidence", 0.0),
            }
            for t in tokens
        ]
        mapped = (
            _map_qwen_units_to_lines(
                {"segments": [{"words": words}]},
                clean_lines[first : last + 1],
                line_spans[first : last + 1],
                language,
                None,
            )
            if words
            else []
        )
        lines: list[dict | None] = []
        for index in range(first, last + 1):
            if mapped and mapped[0]["text"] == clean_lines[index]:
                segment = mapped.pop(0)
                words = segment["words"]
                if any(b["start"] - a["end"] > MAX_WORD_GAP_SECONDS for a, b in zip(words, words[1:])):
                    lines.append(None)
                    continue
                _hold_words_in_window(segment["words"], segment["words"][-1]["end"])
                lines.append(segment)
            else:
                lines.append(None)
        return lines

    def sound(segment: dict | None) -> bool:
        return segment is not None and not _line_squashed(segment)

    def keepable(first: int, lines: list[dict | None], expected: list[float]) -> list[int]:
        kept = []
        for index, segment, shift in zip(range(first, first + len(lines)), lines, expected):
            if not sound(segment):
                continue
            confidence = _line_confidence(segment)
            drift = abs(segment["start"] - lrc_start[index] - shift)
            if (confidence >= MIN_LINE_CONFIDENCE and drift <= CLOSE_DRIFT_SECONDS) or (
                confidence >= SURE_LINE_CONFIDENCE and drift <= LINE_DRIFT_SECONDS
            ):
                kept.append(index)
        return kept

    def jump(first: int, lines: list[dict | None], include_pending: bool) -> float | None:
        """An offset JUMP_LINES sound lines agree on with a mean confidence of
        SURE_LINE_CONFIDENCE, if any."""
        candidates = {index: segment for index, (segment, _) in pending.items()} if include_pending else {}
        candidates.update(enumerate(lines, first))
        found = [
            (segment["start"] - lrc_start[index], _line_confidence(segment))
            for index, segment in candidates.items()
            if sound(segment) and _line_confidence(segment) >= MIN_LINE_CONFIDENCE
        ]
        groups = [[f for f in found if abs(f[0] - candidate) <= CLOSE_DRIFT_SECONDS] for candidate, _ in found]
        group = max(groups, key=lambda g: (len(g), sum(c for _, c in g)), default=[])
        if len(group) < JUMP_LINES or np.mean([c for _, c in group]) < SURE_LINE_CONFIDENCE:
            return None
        return float(np.median([o for o, _ in group]))

    def align_confident(
        first: int, last: int, start: float, end: float, preferred: bool,
        expected: list[float] | None, may_jump: bool,
    ) -> tuple[list[dict | None], list[int], bool]:
        """Lines first..last aligned on start..end, the indices of the ones
        kept and whether they came from the mix. Lines are kept near their
        ``expected`` offsets, or near a jump supported by multiple lines when
        ``may_jump`` (with no expected offsets, only that)."""
        best: tuple[list[dict | None], list[int], bool] | None = None
        best_rank = (-1, -math.inf)
        for on_mix in (preferred, not preferred) if mix_path else (False,):
            lines = align_span(first, last, start, end, on_mix)
            kept = keepable(first, lines, expected) if expected is not None else []
            jumped = jump(first, lines, expected is None) if may_jump else None
            if jumped is not None:
                kept = max(kept, keepable(first, lines, [jumped] * len(lines)), key=len)
            rank = (len(kept), sum(_line_confidence(segment) for segment in lines if sound(segment)))
            if rank > best_rank:
                best = (lines, kept, on_mix)
                best_rank = rank
            if len(kept) == last - first + 1:
                break
        return best

    def neighbours(first: int, last: int) -> tuple[int | None, int | None]:
        previous = next((i for i in range(first - 1, -1, -1) if results[i] is not None), None)
        following = next((i for i in range(last + 1, count) if results[i] is not None), None)
        return previous, following

    def neighbour_offsets(first: int, last: int, fallback: float) -> list[float]:
        """Offsets for lines first..last from the aligned lines around them:
        interpolated when the neighbours agree, otherwise split at the longest
        LRC pause between them, where a recording is most likely cut."""
        previous, following = neighbours(first, last)
        span = range(first, last + 1)
        if previous is None and following is None:
            return [fallback for _ in span]
        if previous is None or following is None:
            return [offset_of(following if previous is None else previous) for _ in span]
        before, after = offset_of(previous), offset_of(following)
        if abs(after - before) < OFFSET_STEP_SECONDS:
            reach = lrc_start[following] - lrc_start[previous]
            return [
                before + (after - before) * (lrc_start[i] - lrc_start[previous]) / reach if reach > 0 else before
                for i in span
            ]
        cut = max(range(previous, following), key=lambda i: lrc_start[i + 1] - lrc_end[i])
        return [before if i <= cut else after for i in span]

    def floor_after(index: int | None) -> float:
        return 0.0 if index is None else results[index]["words"][-1]["start"] + MIN_WORD_SECONDS

    offset: float | None = None
    lost = True
    floor = 0.0
    first = 0
    while first < count:
        shift = offset or 0.0
        search = WIDE_SEARCH_SECONDS if lost else SEARCH_SECONDS
        on_mix = unvoiced(first, shift)
        last = first
        while (
            last + 1 < count
            and unvoiced(last + 1, shift) == on_mix
            and lrc_end[last + 1] - lrc_start[first] <= CHUNK_LRC_SECONDS
        ):
            last += 1
        start = min(max(floor, lrc_start[first] + shift - search), max(floor, duration - 1.0))

        def chunk_end(line: int) -> float:
            return min(duration, start + MAX_CHUNK_SECONDS, max(start + 1.0, lrc_end[line] + shift + search))

        while last > first and not aligner.fits(
            chunk_end(last) - start, "\n".join(clean_lines[first : last + 1]), language,
        ):
            last -= 1
        end = chunk_end(last)
        progress(
            80 + 6 * first // count,
            f"Aligning lyric lines: {first + 1}-{last + 1}/{count}",
        )
        lines, kept, mixed = align_confident(
            first, last, start, end, on_mix, None if offset is None else [offset] * (last - first + 1), True,
        )
        settled = last if last + 1 == count or last == first else last - 1
        kept = [index for index in kept if index <= settled]
        for index in kept:
            results[index] = lines[index - first]
            from_mix[index] = mixed
        if kept:
            next_offset = float(np.median([offset_of(index) for index in kept]))
            if offset is None:
                for index, (segment, on_mix) in pending.items():
                    if keepable(index, [segment], [next_offset]):
                        results[index] = segment
                        from_mix[index] = on_mix
                pending.clear()
            offset = next_offset
            floor = floor_after(kept[-1])
        elif offset is None:
            for index in range(first, settled + 1):
                segment = lines[index - first]
                if sound(segment) and _line_confidence(segment) >= MIN_LINE_CONFIDENCE:
                    pending[index] = (segment, mixed)
        lost = not kept
        first = settled + 1

    runs: list[list[int]] = []
    for index in range(count):
        if results[index] is not None:
            continue
        if runs and runs[-1][-1] == index - 1 and lrc_end[index] - lrc_start[runs[-1][0]] <= CHUNK_LRC_SECONDS:
            runs[-1].append(index)
        else:
            runs.append([index])
    repaired = 0
    for run in runs:
        first, last = run[0], run[-1]
        progress(86 + 2 * first // count, f"Re-aligning missing lines {first + 1}-{last + 1}")
        previous, following = neighbours(first, last)
        low = floor_after(previous)
        high = results[following]["start"] if following is not None else duration
        offsets = neighbour_offsets(first, last, offset or 0.0)
        bounded = previous is not None and following is not None and high - low <= MAX_CHUNK_SECONDS
        if bounded:
            start, end = low, high
        else:
            start = max(low, lrc_start[first] + offsets[0] - REPAIR_PAD_SECONDS)
            end = min(high, lrc_end[last] + offsets[-1] + REPAIR_PAD_SECONDS)
        if end - start < 0.5 or not aligner.fits(end - start, "\n".join(clean_lines[first : last + 1]), language):
            continue
        lines, kept, mixed = align_confident(
            first, last, start, end, unvoiced(first, offsets[0]), offsets, False,
        )
        for index in kept:
            results[index] = lines[index - first]
            from_mix[index] = mixed
            repaired += 1

    if successful_calls == 0 and count:
        raise RuntimeError("Qwen could not process any audio chunks")

    # The stem has no voice under lines aligned on the mix, so only stem
    # alignments are trimmed to its sung parts.
    _trim_words_to_vocals(
        [segment for segment, mixed in zip(results, from_mix) if segment is not None and not mixed], audio,
    )

    aligned = [index for index in range(count) if results[index] is not None]
    estimated = 0
    for index in range(count):
        if results[index] is not None:
            continue
        estimated += 1
        shift = neighbour_offsets(index, index, offset or 0.0)[0]
        _, following = neighbours(index, index)
        low = floor_after(index - 1) if index > 0 else 0.0
        high = results[following]["start"] if following is not None else duration
        start = lrc_start[index] + shift
        reach = max(start, min(windows[index][1] + shift, high))
        if not unvoiced(index, shift):
            voiced = np.flatnonzero(~frames(start, reach))
            if len(voiced) and voiced[0] * ENERGY_FRAME_SECONDS > LATE_ENTRY_SECONDS:
                start += voiced[0] * ENERGY_FRAME_SECONDS
        start = min(max(start, low), max(low, high - MIN_WORD_SECONDS))
        end = max(start + MIN_WORD_SECONDS, min(start + _sung_seconds(clean_lines[index]), lrc_end[index] + shift, high))
        words = _spread_words(clean_lines[index], start, end, language)
        results[index] = {"text": clean_lines[index], "start": words[0]["start"], "end": words[-1]["end"], "words": words}

    offsets = [round(results[index]["start"] - lrc_start[index], 1) for index in aligned]
    print(
        f"[nightingale:LOG] Qwen chunked alignment: {count} lines, {len(aligned)} aligned "
        f"({sum(from_mix[i] for i in aligned)} on the mix, {repaired} between neighbours), "
        f"{estimated} estimated; LRC offset {min(offsets, default=0):+.1f}..{max(offsets, default=0):+.1f}s",
        flush=True,
    )
    return results


def _line_squashed(segment: dict) -> bool:
    """Most of the line's words were stacked onto one moment."""
    words = segment["words"]
    if len(words) == 1:
        return words[0]["end"] - words[0]["start"] <= MIN_WORD_SECONDS
    spacing = (words[-1]["start"] - words[0]["start"]) / (len(words) - 1)
    stacked = sum(1 for w in words if w["end"] - w["start"] <= MIN_WORD_SECONDS)
    return spacing < MIN_WORD_SECONDS or (len(words) >= 4 and stacked * 2 >= len(words))


def _map_qwen_units_to_lines(
    align_result: dict,
    clean_lines: list[str],
    line_spans: list[list[tuple[int, int, str]]],
    language: str,
    line_windows: list[tuple[float, float]] | None = None,
) -> list[dict]:
    """Map Qwen's timed-token stream onto lyric lines.

    With LRC windows, output segments map directly to their source lines.
    Otherwise, token surfaces concatenate to each line's kept content, so a
    running kept-char counter attributes tokens without normalized-text matching.
    Readings are attached per line for CJK/Korean.

    Qwen's tokenizer can merge the last word of a line with the first of the next
    (金の塔 / 北の丘 -> "塔北"), so such units are split at the line boundary
    first, and the counter is cumulative so any leftover mismatch stays local
    instead of shifting every following line.
    """
    line_lens = [cjk.qwen_kept_len(line) for line in clean_lines]
    window_units = (
        [
            _collect_aligned({"segments": [segment]})
            for segment in align_result.get("segments", [])
        ]
        if line_windows is not None
        else None
    )
    units = (
        []
        if window_units is not None
        else _split_units_at_boundaries(
            _collect_aligned(align_result),
            set(itertools.accumulate(line_lens)),
        )
    )
    segments: list[dict] = []
    cursor = 0
    consumed = 0
    target = 0

    for index, (line_text, spans, need) in enumerate(zip(clean_lines, line_spans, line_lens)):
        if need == 0:
            continue
        target += need

        if window_units is not None:
            taken = window_units[index] if index < len(window_units) else []
        else:
            taken: list[dict] = []
            while cursor < len(units) and consumed < target:
                u = units[cursor]
                cursor += 1
                taken.append(u)
                consumed += cjk.qwen_kept_len(u["word"])

        words: list[dict] = []
        for u in taken:
            if u["start"] is None or u["end"] is None:
                continue
            entry = {"word": u["word"], "start": round(u["start"], 3), "end": round(u["end"], 3)}
            if entry["end"] < entry["start"]:
                entry["end"] = entry["start"]
            if u["score"] is not None:
                entry["score"] = round(u["score"], 3)
            words.append(entry)

        if not words and line_windows is not None:
            start, end = line_windows[index]
            words = [{"word": line_text, "start": start, "end": end, "estimated": True}]
        if not words:
            continue

        if cjk.is_supported_lang(language) or spans:
            cjk.attach_reading(words, language, line=line_text, spans=spans)
        if line_windows is not None:
            _hold_words_in_window(words, line_windows[index][1])

        seg_start = words[0]["start"]
        seg_end = words[-1]["end"]
        if seg_end < seg_start:
            seg_end = seg_start

        segments.append({
            "text": line_text,
            "start": seg_start,
            "end": seg_end,
            "words": words,
        })

    return segments


def _split_units_at_boundaries(units: list[dict], boundaries: set[int]) -> list[dict]:
    """Split units whose kept chars straddle a cumulative line boundary.

    Each piece keeps its share of the unit's time span, proportional to its
    kept-char count.
    """
    out: list[dict] = []
    consumed = 0
    for u in units:
        n = cjk.qwen_kept_len(u["word"])
        cuts = sorted(b - consumed for b in boundaries if consumed < b < consumed + n)
        consumed += n
        if not cuts:
            out.append(u)
            continue

        pieces: list[str] = []
        current = ""
        kept = 0
        for ch in u["word"]:
            current += ch
            kept += cjk.qwen_kept_len(ch)
            if cuts and kept == cuts[0]:
                pieces.append(current)
                current = ""
                cuts.pop(0)
        if current:
            pieces.append(current)

        timed = u["start"] is not None and u["end"] is not None
        offset = 0
        for piece in pieces:
            k = cjk.qwen_kept_len(piece)
            part = dict(u, word=piece, norm=_normalize(piece))
            if timed:
                span = u["end"] - u["start"]
                part["start"] = u["start"] + span * offset / n
                part["end"] = u["start"] + span * (offset + k) / n
            offset += k
            out.append(part)
    return out


def _map_words_to_lines(
    align_result: dict,
    clean_lines: list[str],
    line_spans: list[list[tuple[int, int, str]]],
    language: str,
    line_windows: list[tuple[float, float]] | None = None,
) -> list[dict]:
    """Map aligned word timestamps back to original lyric lines.

    Without LRC windows, walks the aligned stream with a single forward cursor
    and bounded lookahead. With windows, each line only searches its own output
    segment so a failed line cannot consume a later line's timestamps.
    """
    aligned = _collect_aligned(align_result)
    timed_count = sum(1 for a in aligned if a["start"] is not None and a["end"] is not None)
    print(
        f"[nightingale:LOG] Final alignment: {len(aligned)} words emitted "
        f"({timed_count} timed, {len(aligned) - timed_count} NaN)",
        flush=True,
    )

    LOOKAHEAD = 6
    ai = 0
    window_words = (
        [
            _collect_aligned({"segments": [segment]})
            for segment in align_result.get("segments", [])
        ]
        if line_windows is not None
        else None
    )
    segments = []
    missed_lyric_words = 0
    interpolated_drops = 0

    for index, (line_text, spans) in enumerate(zip(clean_lines, line_spans)):
        candidates = (
            window_words[index]
            if window_words is not None and index < len(window_words)
            else ([] if window_words is not None else aligned)
        )
        line_ai = 0 if window_words is not None else ai
        word_entries = []
        for word_text in line_text.split():
            target = _normalize(word_text)
            matched = -1
            if target:
                limit = min(line_ai + LOOKAHEAD, len(candidates))
                for k in range(line_ai, limit):
                    if candidates[k]["norm"] == target:
                        matched = k
                        break

            if matched >= 0:
                a = candidates[matched]
                line_ai = matched + 1
                if a["start"] is not None and a["end"] is not None:
                    entry = {
                        "word": word_text,
                        "start": round(a["start"], 3),
                        "end": round(a["end"], 3),
                    }
                    if a["score"] is not None:
                        entry["score"] = round(a["score"], 3)
                else:
                    entry = {"word": word_text, "start": None, "end": None, "estimated": True}
                    interpolated_drops += 1
            else:
                entry = {"word": word_text, "start": None, "end": None, "estimated": True}
                missed_lyric_words += 1
            word_entries.append(entry)

        if window_words is None:
            ai = line_ai
        _interpolate_missing(word_entries)

        valid_words = [e for e in word_entries if e["start"] is not None]
        if not valid_words and line_windows is not None:
            # Nothing in this line aligned: keep it as one token over its window.
            start, end = line_windows[index]
            valid_words = [{"word": line_text, "start": start, "end": end, "estimated": True}]
        if not valid_words:
            continue
        if cjk.is_supported_lang(language) or spans:
            cjk.attach_reading(valid_words, language, line=line_text, spans=spans)
        if line_windows is not None:
            _hold_words_in_window(valid_words, line_windows[index][1])

        seg_start = valid_words[0]["start"]
        seg_end = valid_words[-1]["end"]
        if seg_end < seg_start:
            seg_end = seg_start

        segments.append({
            "text": line_text,
            "start": seg_start,
            "end": seg_end,
            "words": valid_words,
        })

    total_words = sum(len(s["words"]) for s in segments)
    print(
        f"[nightingale:LOG] Lyrics alignment: {len(segments)} lines preserved, "
        f"{total_words} words ({interpolated_drops} interpolated from NaN, "
        f"{missed_lyric_words} unmatched lyric words)",
        flush=True,
    )

    return segments


def _interpolate_missing(word_entries: list[dict]):
    """Fill in timestamps for words the aligner couldn't place, using neighbors."""
    unset = [i for i, e in enumerate(word_entries) if e["start"] is None]
    set_entries = [e for e in word_entries if e["start"] is not None]

    if not unset or not set_entries:
        return

    for ui in unset:
        prev_end = set_entries[0]["start"]
        next_start = set_entries[-1]["end"]
        for j in range(ui - 1, -1, -1):
            if word_entries[j]["start"] is not None:
                prev_end = word_entries[j]["end"]
                break
        for j in range(ui + 1, len(word_entries)):
            if word_entries[j]["start"] is not None:
                next_start = word_entries[j]["start"]
                break
        mid = (prev_end + next_start) / 2
        word_entries[ui]["start"] = round(prev_end, 3)
        word_entries[ui]["end"] = round(mid, 3)
