use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use ts_rs::TS;

use crate::analyzer::{
    enqueue_one, is_usdx_song, mark_stems_only, prepare_lrc_no_stems, update_song_analyzed,
};
use crate::cache::CacheDir;
use crate::library_db;
use crate::lrc::{self, ParsedLrc};
use crate::song::{Song, TranscriptSource, read_transcript_meta};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LrclibCandidate {
    #[serde(default, alias = "trackName")]
    pub track_name: String,
    #[serde(default, alias = "artistName")]
    pub artist_name: String,
    #[serde(default, alias = "albumName")]
    pub album_name: String,
    #[serde(default, alias = "duration")]
    pub duration_secs: f64,
    #[serde(skip_deserializing, default)]
    pub lines: Vec<String>,
    /// Raw LRC (line-level synced lyrics) from LRCLIB, when available. Exposed
    /// to the frontend so the editor can offer timed lyrics without alignment.
    /// `alias` (not `rename`) so it deserializes from LRCLIB's `syncedLyrics`
    /// but still serializes as `synced_lyrics` for the frontend type.
    #[serde(default, alias = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
    #[serde(default, rename = "plainLyrics", skip_serializing)]
    #[ts(skip)]
    plain_lyrics: String,
    #[serde(default, skip_serializing)]
    #[ts(skip)]
    lyricsfile: Option<String>,
}

pub(crate) struct TimedLyrics {
    pub parsed: ParsedLrc,
    pub lyricsfile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LyricsFile {
    pub lines: Vec<String>,
}
static LRCLIB_RETRY_AFTER: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));

fn lrclib_request<T: serde::de::DeserializeOwned>(url: &str) -> Result<Option<T>, String> {
    let blocked_until = LRCLIB_RETRY_AFTER.lock().unwrap_or_else(|e| e.into_inner());
    if blocked_until
        .as_ref()
        .is_some_and(|until| Instant::now() < *until)
    {
        return Err("LRCLIB rate limit reached. Retry analysis later.".into());
    }
    drop(blocked_until);

    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_recv_response(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build();
    let agent = ureq::Agent::new_with_config(config);
    for attempt in 0..4 {
        let mut response = agent
            .get(url)
            .header(
                "User-Agent",
                concat!("Nightingale/", env!("CARGO_PKG_VERSION")),
            )
            .call()
            .map_err(|_| "LRCLIB is unavailable. Retry analysis later.".to_string())?;

        match response.status().as_u16() {
            200 => {
                return response
                    .body_mut()
                    .with_config()
                    .limit(1024 * 1024)
                    .read_json()
                    .map(Some)
                    .map_err(|_| "LRCLIB returned invalid or oversized lyrics data.".to_string());
            }
            404 => return Ok(None),
            429 => {
                let seconds = response
                    .headers()
                    .get("Retry-After")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(60)
                    .min(3600);
                let mut blocked_until =
                    LRCLIB_RETRY_AFTER.lock().unwrap_or_else(|e| e.into_inner());
                *blocked_until = Some(Instant::now() + Duration::from_secs(seconds));
                return Err("LRCLIB rate limit reached. Retry analysis later.".into());
            }
            503 if attempt < 3 => {
                let seconds = response
                    .headers()
                    .get("Retry-After")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(1 << attempt)
                    .clamp(1, 30);
                std::thread::sleep(Duration::from_secs(seconds));
            }
            _ => return Err("LRCLIB is unavailable. Retry analysis later.".into()),
        }
    }

    Err("LRCLIB is unavailable. Retry analysis later.".into())
}

fn fold_name(value: &str) -> String {
    let mut folded = String::with_capacity(value.len());
    for character in value.trim().chars().flat_map(char::to_lowercase) {
        let replacement = match character {
            'а' => "a",
            'б' => "b",
            'в' => "v",
            'г' => "g",
            'д' => "d",
            'е' | 'э' => "e",
            'ё' => "yo",
            'ж' => "zh",
            'з' => "z",
            'и' => "i",
            'й' | 'ы' => "y",
            'к' => "k",
            'л' => "l",
            'м' => "m",
            'н' => "n",
            'о' => "o",
            'п' => "p",
            'р' => "r",
            'с' => "s",
            'т' => "t",
            'у' => "u",
            'ф' => "f",
            'х' => "kh",
            'ц' => "ts",
            'ч' => "ch",
            'ш' => "sh",
            'щ' => "shch",
            'ю' => "yu",
            'я' => "ya",
            'ъ' | 'ь' => "",
            _ => {
                if character.is_alphanumeric() {
                    folded.push(character);
                }
                continue;
            }
        };
        folded.push_str(replacement);
    }
    folded
}

fn search_lrclib(song: &Song, title_only: bool) -> Result<Vec<LrclibCandidate>, String> {
    let mut url = format!(
        "https://lrclib.net/api/search?track_name={}",
        urlencoding::encode(&song.title),
    );
    if !title_only {
        url.push_str("&artist_name=");
        url.push_str(&urlencoding::encode(&song.artist));
    }
    std::thread::sleep(Duration::from_millis(300));
    Ok(lrclib_request::<Vec<LrclibCandidate>>(&url)?.unwrap_or_default())
}

fn pick_timed_lyrics(song: &Song, results: Vec<LrclibCandidate>) -> Option<TimedLyrics> {
    results
        .into_iter()
        .filter_map(|candidate| {
            valid_timed_candidate(song, &candidate).map(|parsed| {
                let album_match = fold_name(&candidate.album_name) == fold_name(&song.album);
                (
                    (candidate.duration_secs - song.duration_secs).abs(),
                    album_match,
                    parsed,
                )
            })
        })
        .min_by(|a, b| a.0.total_cmp(&b.0).then_with(|| b.1.cmp(&a.1)))
        .map(|(_, _, parsed)| parsed)
}

pub(crate) fn fetch_lrclib_timed_lyrics(song: &Song) -> Result<TimedLyrics, String> {
    if song.title.trim().is_empty()
        || song.artist.trim().is_empty()
        || song.artist == "Unknown Artist"
        || !song.duration_secs.is_finite()
        || song.duration_secs <= 0.0
    {
        return Err(
            "Song title, artist, and duration are required for LRCLIB timed lyrics.".into(),
        );
    }

    std::thread::sleep(Duration::from_millis(300));
    let mut url = format!(
        "https://lrclib.net/api/get?track_name={}&artist_name={}",
        urlencoding::encode(&song.title),
        urlencoding::encode(&song.artist),
    );
    if (1.0..=3600.0).contains(&song.duration_secs) {
        url.push_str(&format!("&duration={}", song.duration_secs.round()));
    }

    if let Some(candidate) = lrclib_request::<LrclibCandidate>(&url)?
        && let Some(parsed) = valid_timed_candidate(song, &candidate)
    {
        return Ok(parsed);
    }

    if let Some(parsed) = pick_timed_lyrics(song, search_lrclib(song, false)?) {
        return Ok(parsed);
    }

    pick_timed_lyrics(song, search_lrclib(song, true)?).ok_or_else(|| {
        "No matching synchronized lyrics found on LRCLIB. Provide timed LRC manually.".into()
    })
}

fn valid_timed_candidate(song: &Song, candidate: &LrclibCandidate) -> Option<TimedLyrics> {
    if fold_name(&song.title) != fold_name(&candidate.track_name)
        || fold_name(&song.artist) != fold_name(&candidate.artist_name)
        || !candidate.duration_secs.is_finite()
        || (song.duration_secs - candidate.duration_secs).abs() > 2.0
    {
        return None;
    }

    let parsed = lrc::parse_lrc(candidate.synced_lyrics.as_deref()?).ok()?;
    let max_time = song.duration_secs + 2.0;
    parsed
        .segments
        .iter()
        .all(|segment| {
            segment.start.is_finite()
                && segment.end.is_finite()
                && segment.start <= max_time
                && segment.end > segment.start
        })
        .then(|| TimedLyrics {
            parsed,
            lyricsfile: candidate
                .lyricsfile
                .clone()
                .filter(|value| !value.trim().is_empty()),
        })
}

pub(crate) fn lrclib_candidates(song: &Song) -> Vec<LrclibCandidate> {
    if song.title.trim().is_empty() {
        return Vec::new();
    }

    let mut results = if song.artist.trim().is_empty() || song.artist == "Unknown Artist" {
        Vec::new()
    } else {
        search_lrclib(song, false).unwrap_or_else(|error| {
            warn!("[lrclib] Artist search failed: {error}");
            Vec::new()
        })
    };
    match search_lrclib(song, true) {
        Ok(title_results) => {
            for candidate in title_results {
                let duplicate = results.iter().any(|existing: &LrclibCandidate| {
                    existing.track_name == candidate.track_name
                        && existing.artist_name == candidate.artist_name
                        && existing.album_name == candidate.album_name
                        && existing.duration_secs.to_bits() == candidate.duration_secs.to_bits()
                        && existing.synced_lyrics == candidate.synced_lyrics
                        && existing.plain_lyrics == candidate.plain_lyrics
                });
                if !duplicate {
                    results.push(candidate);
                }
            }
        }
        Err(error) => warn!("[lrclib] Title search failed: {error}"),
    }

    let mut with_lyrics: Vec<_> = results
        .into_iter()
        .filter(|r| {
            !r.plain_lyrics.is_empty()
                || r.synced_lyrics
                    .as_deref()
                    .is_some_and(|s| !s.trim().is_empty())
        })
        .collect();

    info!(
        "[lrclib] Search returned {} results with lyrics",
        with_lyrics.len()
    );

    let title = fold_name(&song.title);
    let artist = fold_name(&song.artist);
    let album = fold_name(&song.album);
    with_lyrics.sort_by(|a, b| {
        let rank = |candidate: &LrclibCandidate| {
            (
                fold_name(&candidate.track_name) != title,
                fold_name(&candidate.artist_name) != artist,
                candidate.synced_lyrics.is_none(),
            )
        };
        rank(a)
            .cmp(&rank(b))
            .then_with(|| {
                (a.duration_secs - song.duration_secs)
                    .abs()
                    .total_cmp(&(b.duration_secs - song.duration_secs).abs())
            })
            .then_with(|| {
                (fold_name(&a.album_name) != album).cmp(&(fold_name(&b.album_name) != album))
            })
    });

    with_lyrics
        .into_iter()
        .filter_map(|mut r| {
            r.lines = r
                .plain_lyrics
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            // Normalize empty synced payloads to `None` so the frontend can
            // treat "has LRC" as a simple presence check.
            if r.synced_lyrics
                .as_deref()
                .is_some_and(|s| s.trim().is_empty())
            {
                r.synced_lyrics = None;
            }
            if r.lines.is_empty() && r.synced_lyrics.is_none() {
                None
            } else {
                Some(r)
            }
        })
        .collect()
}

pub fn search_lrclib_for_hash(file_hash: &str) -> Vec<LrclibCandidate> {
    let Some(song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return Vec::new();
    };
    lrclib_candidates(&song)
}

pub fn load_lyrics_file(file_hash: &str) -> Option<LyricsFile> {
    let cache = CacheDir::new();
    let path = cache.lyrics_path(file_hash);
    if !path.is_file() {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    serde_json::from_slice::<LyricsFile>(&bytes).ok()
}

pub fn save_lyrics_and_realign(file_hash: &str, lines: Vec<String>) -> Result<(), String> {
    if is_usdx_song(file_hash) {
        return Err("Cannot edit lyrics for USDX songs".to_string());
    }

    let normalized: Vec<String> = lines
        .into_iter()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if normalized.is_empty() {
        return Err("Lyrics cannot be empty".to_string());
    }

    let cache = CacheDir::new();
    let previous_language = library_db::load_song_by_hash(file_hash)
        .ok()
        .flatten()
        .and_then(|song| song.language);
    write_lyrics_file(&cache, file_hash, &normalized)
        .map_err(|e| format!("Failed to write lyrics file: {e}"))?;

    let _ = std::fs::remove_file(cache.transcript_path(file_hash));
    cache.delete_transcript_variants(file_hash);

    update_song_analyzed(file_hash, false, previous_language, None, None, None);
    enqueue_one(file_hash);
    Ok(())
}

/// Build the transcript JSON (playback shape) from parsed LRC segments.
fn build_lrc_transcript(
    parsed: &ParsedLrc,
    language: Option<&str>,
    key: Option<&str>,
    tempo: f64,
    no_stems: bool,
) -> serde_json::Value {
    serde_json::json!({
        // Leave language null when unknown so it isn't later mistaken for a
        // forced alignment language override (whisperx has no "unknown" model).
        "language": language,
        "source": "lrc",
        "key": key,
        "tempo": tempo,
        "no_stems": no_stems,
        "segments": parsed.segments,
    })
}

pub(crate) fn write_lrclib_transcript(
    song: &Song,
    cache: &CacheDir,
    parsed: &ParsedLrc,
) -> Result<(), String> {
    let mut value = build_lrc_transcript(parsed, song.language.as_deref(), None, 1.0, false);
    value["source"] = serde_json::json!("lrclib_pending");
    write_transcript_json(cache, &song.file_hash, &value)
        .map_err(|_| "Failed to save timed lyrics before analysis.".to_string())
}

fn write_transcript_json(
    cache: &CacheDir,
    file_hash: &str,
    value: &serde_json::Value,
) -> std::io::Result<()> {
    let out = cache.transcript_path(file_hash);
    let json = serde_json::to_vec_pretty(value).map_err(std::io::Error::other)?;
    std::fs::write(&out, json)
}

/// Provide LRC / Enhanced LRC for a not-yet-analyzed song, building the
/// transcript directly and skipping transcription. When `separate_stems` is
/// true, a stems-only analysis pass is queued (guide vocals + karaoke
/// instrumental); otherwise the song plays over its original mix and the guide
/// control is hidden on playback.
pub fn provide_lrc(file_hash: &str, lrc_text: &str, separate_stems: bool) -> Result<(), String> {
    if is_usdx_song(file_hash) {
        return Err("Cannot provide lyrics for USDX songs".to_string());
    }

    let parsed = lrc::parse_lrc(lrc_text)?;

    let Some(song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return Err("Song not found".to_string());
    };

    let cache = CacheDir::new();
    cache.delete_transcript_variants(file_hash);
    let _ = std::fs::remove_file(cache.lyrics_path(file_hash));

    let language = song.language.clone();

    if separate_stems {
        let value = build_lrc_transcript(&parsed, language.as_deref(), None, 1.0, false);
        write_transcript_json(&cache, file_hash, &value)
            .map_err(|e| format!("Failed to write transcript: {e}"))?;
        // Stays not-analyzed until stem separation finishes.
        update_song_analyzed(file_hash, false, language, None, None, None);
        mark_stems_only(file_hash);
        enqueue_one(file_hash);
    } else {
        let value = build_lrc_transcript(&parsed, language.as_deref(), None, 1.0, true);
        write_transcript_json(&cache, file_hash, &value)
            .map_err(|e| format!("Failed to write transcript: {e}"))?;
        // Playing over the original mix needs no separation. Prepare everything
        // synchronously (materialize audio, detect the key) and only then mark
        // the song ready — no status-queue pass, and no transient window where
        // playback assets aren't in place yet.
        prepare_lrc_no_stems(file_hash).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Apply provided timed LRC to an already-analyzed song, rebuilding the
/// transcript directly (no realignment) while keeping the existing stems.
pub fn apply_timed_lyrics(file_hash: &str, lrc_text: &str) -> Result<(), String> {
    if is_usdx_song(file_hash) {
        return Err("Cannot edit lyrics for USDX songs".to_string());
    }

    let parsed = lrc::parse_lrc(lrc_text)?;

    let Some(song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return Err("Song not found".to_string());
    };

    let cache = CacheDir::new();
    let meta = read_transcript_meta(&cache, file_hash);
    // Base (unshifted) key so timings line up with the canonical stems.
    let key = song.key.clone().or(meta.key);
    let no_stems = song.no_stems;

    // Timing changed: drop any tempo-shifted transcript variants and the plain
    // lyrics sidecar, and reset the song back to its base key/tempo.
    cache.delete_transcript_variants(file_hash);
    let _ = std::fs::remove_file(cache.lyrics_path(file_hash));

    let value = build_lrc_transcript(
        &parsed,
        song.language.as_deref(),
        key.as_deref(),
        1.0,
        no_stems,
    );
    write_transcript_json(&cache, file_hash, &value)
        .map_err(|e| format!("Failed to write transcript: {e}"))?;

    let mut updated = song;
    updated.is_analyzed = true;
    updated.transcript_source = Some(TranscriptSource::Lrc);
    updated.key = key;
    updated.override_key = None;
    updated.tempo = 1.0;
    updated.key_offset = 0;
    updated.no_stems = no_stems;
    library_db::update_song_fields(file_hash, &updated).map_err(|e| e.to_string())?;

    Ok(())
}

pub(crate) fn write_lyrics_file(
    cache: &CacheDir,
    file_hash: &str,
    lines: &[String],
) -> std::io::Result<PathBuf> {
    let out = cache.lyrics_path(file_hash);
    let lyrics_json = serde_json::json!({ "lines": lines });
    let json = serde_json::to_vec_pretty(&lyrics_json).map_err(std::io::Error::other)?;
    std::fs::write(&out, json)?;
    Ok(out)
}
