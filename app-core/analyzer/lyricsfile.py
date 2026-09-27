"""Read LRCLIB Lyricsfile word timings without trusting arbitrary YAML features."""

import yaml
from yaml.events import AliasEvent


class LyricsfileLoader(yaml.SafeLoader):
    def compose_node(self, parent, index):
        if self.check_event(AliasEvent):
            raise ValueError("YAML aliases are not supported in lyrics")
        return super().compose_node(parent, index)

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str) or key in seen:
                raise ValueError("Invalid or duplicate lyrics key")
            seen.add(key)
        return super().construct_mapping(node, deep=deep)


def _milliseconds(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def parse_word_synced(raw, duration_secs):
    """Return (segments, language) if every nonempty line has valid word timings."""
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > 1024 * 1024:
        return None, None

    try:
        document = yaml.load(raw, Loader=LyricsfileLoader)
    except (yaml.YAMLError, ValueError):
        return None, None

    if not isinstance(document, dict) or document.get("version") != "1.0":
        return None, None

    metadata = document.get("metadata")
    language = metadata.get("language") if isinstance(metadata, dict) else None
    if not isinstance(language, str) or len(language) != 2 or not language.isascii() or not language.isalpha():
        language = None
    else:
        language = language.lower()

    lines = document.get("lines")
    if not isinstance(lines, list) or not 0 < len(lines) <= 1000:
        return None, language

    segments = []
    total_words = 0
    max_ms = int((duration_secs + 2) * 1000)
    for line_index, line in enumerate(lines):
        if not isinstance(line, dict) or not isinstance(line.get("text"), str):
            return None, language
        text = line["text"]
        if not text.strip():
            continue

        start = _milliseconds(line.get("start_ms"))
        end = _milliseconds(line.get("end_ms"))
        if end is None and line_index + 1 < len(lines):
            next_line = lines[line_index + 1]
            end = _milliseconds(next_line.get("start_ms")) if isinstance(next_line, dict) else None
        if end is None:
            end = min(max_ms, start + 4000) if start is not None else None
        words = line.get("words")
        if start is None or start > max_ms or not isinstance(words, list) or not words:
            return None, language
        if len(words) > 200:
            return None, language

        parsed_words = []
        for index, word in enumerate(words):
            if not isinstance(word, dict) or not isinstance(word.get("text"), str):
                return None, language
            word_start = _milliseconds(word.get("start_ms"))
            word_end = _milliseconds(word.get("end_ms"))
            if word_end is None and index + 1 < len(words):
                next_word = words[index + 1]
                word_end = _milliseconds(next_word.get("start_ms")) if isinstance(next_word, dict) else None
            if word_end is None:
                word_end = end
            if (not word["text"].strip() or word_start is None or word_end is None
                    or word_start < start or word_end <= word_start or word_end > max_ms):
                return None, language
            parsed_words.append({
                "word": word["text"],
                "start": word_start / 1000,
                "end": word_end / 1000,
            })

        if "".join(word["word"] for word in parsed_words).strip() != text.strip():
            return None, language
        if end is None:
            end = int(parsed_words[-1]["end"] * 1000)
        if end <= start or end > max_ms or parsed_words[-1]["end"] > end / 1000:
            return None, language

        total_words += len(parsed_words)
        if total_words > 20000:
            return None, language
        segments.append({
            "text": text,
            "start": start / 1000,
            "end": end / 1000,
            "words": parsed_words,
        })

    return (segments or None), language
