"""Match a constant video offset against the unmodified local song audio."""

from pathlib import Path

import numpy as np

RATE = 8000
HOP = 160
WINDOW = 1024
MAX_OFFSET_SEC = 120


def features(path):
    audio = np.fromfile(Path(path), dtype='<f4')
    if len(audio) < RATE * 12 or len(audio) > RATE * 300:
        return None
    count = (len(audio) - WINDOW) // HOP + 1
    bands = np.geomspace(100, 3500, 25)
    bins = np.fft.rfftfreq(WINDOW, 1 / RATE)
    masks = [(bins >= lo) & (bins < hi) for lo, hi in zip(bands[:-1], bands[1:])]
    result = np.empty((count, len(masks)), dtype=np.float32)
    taper = np.hanning(WINDOW)
    for start in range(0, count, 256):
        indices = np.arange(start, min(start + 256, count))[:, None] * HOP + np.arange(WINDOW)
        spectrum = np.abs(np.fft.rfft(audio[indices] * taper, axis=1)) ** 2
        result[start:start + len(indices)] = np.stack(
            [np.log1p(spectrum[:, mask].mean(axis=1) * 10000) for mask in masks], axis=1)
    result -= result.mean(axis=0)
    result /= np.maximum(result.std(axis=0), 0.05)
    return result


def match_window(song, video, anchor):
    width = 1000
    sample = song[anchor:anchor + width].astype(np.float64)
    if len(sample) < width or np.mean(sample**2) < 0.1 or len(video) < width:
        return None
    size = 1 << (len(video) + width - 2).bit_length()
    transformed = np.fft.rfft(video, size, axis=0)
    reference = np.fft.rfft(sample[::-1], size, axis=0)
    numerator = np.fft.irfft(transformed * reference, size, axis=0).sum(axis=1)
    numerator = numerator[width - 1:len(video)]
    power = np.concatenate(([0.0], np.cumsum(np.sum(video.astype(np.float64)**2, axis=1))))
    denominator = np.sqrt(np.maximum(power[width:] - power[:-width], 1e-9) * np.sum(sample**2))
    similarity = numerator / denominator
    radius = round(MAX_OFFSET_SEC * RATE / HOP)
    first, last = max(0, anchor - radius), min(len(similarity), anchor + radius + 1)
    if first >= last:
        return None
    position = first + int(np.argmax(similarity[first:last]))
    return ((position - anchor) * HOP / RATE, float(similarity[position]))


def find_offset(song_path, video_path):
    song, video = features(song_path), features(video_path)
    if song is None or video is None:
        return None
    anchors = sorted(set([min(500, max(0, len(song) - 1000)),
                          max(0, (len(song) - 1000) // 2), max(0, len(song) - 1500)]))
    matches = [(anchor, match_window(song, video, anchor)) for anchor in anchors]
    matches = [(anchor, match) for anchor, match in matches if match is not None and match[1] >= 0.5]
    for anchor, (offset, _) in matches:
        consistent = [(other, match) for other, match in matches if abs(match[0] - offset) <= 0.12]
        if any(abs(other - anchor) >= 1000 for other, _ in consistent):
            return round(float(np.median([match[0] for _, match in consistent])), 3)
    return None
