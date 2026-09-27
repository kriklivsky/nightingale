# Lyrics & Timing

Nightingale needs synchronized lyrics before it analyzes a song. Automatic analysis looks up the track on [LRCLIB](https://lrclib.net/docs), then uses the returned `syncedLyrics` LRC timestamps directly. It matches title, artist, and duration; a result with plain text but no timestamps is not enough.

If LRCLIB has no suitable synchronized match, analysis stops **before** key detection and stem separation. The song details show an error and offer **Provide lyrics**. Automatic speech recognition is not used as a fallback. Correct inaccurate library metadata or provide your own timed LRC to continue. Temporary LRCLIB failures and rate limits can be retried later.

When LRCLIB supplies a Lyricsfile with valid word timestamps, Nightingale uses those timestamps directly. If it supplies only line-timed LRC, Nightingale isolates the vocals and uses its existing forced aligner to derive word timestamps. This fallback costs more memory and time than direct word timing. Manually supplied Enhanced LRC also preserves its own word timestamps.

## Manual lyrics

Open a non-USDX song's actions and choose **Provide lyrics** (or **Edit lyrics** for an analyzed song):

- Paste timed **LRC / Enhanced LRC** to use its timestamps directly. You may choose to separate stems for karaoke or play over the original mix.
- Paste plain lyrics to run forced alignment against the isolated vocals. This manual path can still use WhisperX, CTC, or Qwen alignment as selected in **Settings → Analysis**; it does not transcribe missing words.

The **LRCLIB matches** tab in the editor may show both synchronized and plain-text candidates. Prefer **Use LRC** for direct timing. Plain text requires the slower manual alignment path.

## Other analysis stages

After synchronized lyrics are available, Nightingale detects the song key and separates vocals from the instrumental with UVR Karaoke or Demucs. Stem separation remains the expensive, memory-intensive stage; line-only LRC also runs forced word alignment. LRCLIB eliminates speech transcription, not separation or optional alignment. For manually supplied LRC, you can skip separation and play the original mix.

USDX songs already contain lyrics and timing, so they bypass the LRCLIB lookup and transcription. Analysis results and provided lyrics are cached by song hash. Failed analyses remain visible after an app restart until retried or cancelled.
