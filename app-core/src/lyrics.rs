use std::path::{Path, PathBuf};
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
use crate::song::{Song, SongOrigin, TranscriptSource, read_transcript_meta};
use crate::usdx::decode_text;

/// LRCLIB sends `null` for missing text fields; read it as the empty value so
/// one sparse search result does not invalidate the whole response.
fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LrclibCandidate {
    #[serde(default, alias = "trackName", deserialize_with = "null_as_default")]
    pub track_name: String,
    #[serde(default, alias = "artistName", deserialize_with = "null_as_default")]
    pub artist_name: String,
    #[serde(default, alias = "albumName", deserialize_with = "null_as_default")]
    pub album_name: String,
    #[serde(default, alias = "duration", deserialize_with = "null_as_default")]
    pub duration_secs: f64,
    #[serde(skip_deserializing, default)]
    pub lines: Vec<String>,
    /// Raw LRC (line-level synced lyrics) from LRCLIB, when available. Exposed
    /// to the frontend so the editor can offer timed lyrics without alignment.
    /// `alias` (not `rename`) so it deserializes from LRCLIB's `syncedLyrics`
    /// but still serializes as `synced_lyrics` for the frontend type.
    #[serde(default, alias = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
    #[serde(
        default,
        rename = "plainLyrics",
        skip_serializing,
        deserialize_with = "null_as_default"
    )]
    #[ts(skip)]
    plain_lyrics: String,
    #[serde(default, skip_serializing)]
    #[ts(skip)]
    lyricsfile: Option<String>,
}

pub(crate) struct TimedLyrics {
    pub parsed: ParsedLrc,
    pub lyricsfile: Option<String>,
    /// Length of the other release of the song this LRC belongs to; the analyzer
    /// then looks for the shift onto the vocals of this recording.
    pub other_release_secs: Option<f64>,
}

/// What LRCLIB is asked about and its results are compared with.
#[derive(Clone, Copy)]
pub(crate) struct LrclibSong<'a> {
    pub title: &'a str,
    pub artist: &'a str,
    pub album: &'a str,
    pub duration_secs: f64,
}

impl<'a> From<&'a Song> for LrclibSong<'a> {
    fn from(song: &'a Song) -> Self {
        Self {
            title: &song.title,
            artist: &song.artist,
            album: &song.album,
            duration_secs: song.duration_secs,
        }
    }
}

const SHIFT_SEARCH_MARGIN_SECONDS: f64 = 15.0;
const MIN_SHIFT_SEARCH_SECONDS: f64 = 30.0;
const MAX_SHIFT_SEARCH_SECONDS: f64 = 120.0;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LyricsFile {
    pub lines: Vec<String>,
    /// Per-line time windows from line-timed LRC, parallel to `lines`. When
    /// present, alignment only places each line's words inside its window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub windows: Option<Vec<LineWindow>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LineWindow {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SidecarLrcKind {
    Lrc,
    Elrc,
}

impl SidecarLrcKind {
    fn rank(self) -> u8 {
        match self {
            Self::Lrc => 0,
            Self::Elrc => 1,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Lrc => "lrc",
            Self::Elrc => "elrc",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SidecarLrc {
    pub text: String,
    pub file_name: String,
    pub kind: SidecarLrcKind,
}

const SIDECAR_LRC_MAX_BYTES: u64 = 1024 * 1024;

/// LRCLIB answers most requests with 503 while it is overloaded and recovers on
/// its own, so a song waits through such a spell (about 13 minutes) and someone
/// looking at the screen gets an answer within about 20 seconds.
const LRCLIB_ANALYSIS_ATTEMPTS: u32 = 30;
const LRCLIB_ANALYSIS_MAX_BACKOFF_SECONDS: u64 = 30;
const LRCLIB_INTERACTIVE_ATTEMPTS: u32 = 12;
const LRCLIB_INTERACTIVE_MAX_BACKOFF_SECONDS: u64 = 2;
const LRCLIB_BACKOFF_SLICE: Duration = Duration::from_millis(200);

static LRCLIB_RETRY_AFTER: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));

pub(crate) fn lrclib_retry_delay() -> Option<Duration> {
    let blocked_until = LRCLIB_RETRY_AFTER.lock().unwrap_or_else(|e| e.into_inner());
    blocked_until
        .as_ref()
        .and_then(|until| until.checked_duration_since(Instant::now()))
        .filter(|delay| !delay.is_zero())
}

fn lrclib_request<T: serde::de::DeserializeOwned>(
    url: &str,
    wait_for_retry: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<Option<T>, String> {
    let config = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_recv_response(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build();
    let agent = ureq::Agent::new_with_config(config);
    let (attempts, max_backoff) = if wait_for_retry.is_some() {
        (
            LRCLIB_ANALYSIS_ATTEMPTS,
            LRCLIB_ANALYSIS_MAX_BACKOFF_SECONDS,
        )
    } else {
        (
            LRCLIB_INTERACTIVE_ATTEMPTS,
            LRCLIB_INTERACTIVE_MAX_BACKOFF_SECONDS,
        )
    };
    for attempt in 0..attempts {
        if let Some(wait) = wait_for_retry {
            wait()?;
        } else if lrclib_retry_delay().is_some() {
            return Err("LRCLIB rate limit reached. Retry analysis later.".into());
        }

        let request = agent
            .get(url)
            .header(
                "User-Agent",
                concat!("Nightingale/", env!("CARGO_PKG_VERSION")),
            )
            .call();
        let retry_after = match request {
            Err(error) => {
                warn!("[lrclib] Request failed: {error}");
                None
            }
            Ok(mut response) => {
                let status = response.status().as_u16();
                let retry_after = response
                    .headers()
                    .get("Retry-After")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok());
                match status {
                    200 => {
                        return response
                            .body_mut()
                            .with_config()
                            .limit(1024 * 1024)
                            .read_json()
                            .map(Some)
                            .map_err(|_| {
                                "LRCLIB returned invalid or oversized lyrics data.".to_string()
                            });
                    }
                    404 => return Ok(None),
                    429 => {
                        let seconds = retry_after.unwrap_or(60).clamp(1, 3600);
                        let mut blocked_until =
                            LRCLIB_RETRY_AFTER.lock().unwrap_or_else(|e| e.into_inner());
                        *blocked_until = Some(Instant::now() + Duration::from_secs(seconds));
                        if wait_for_retry.is_some() && attempt + 1 < attempts {
                            continue;
                        }
                        return Err("LRCLIB rate limit reached. Retry analysis later.".into());
                    }
                    500..=599 => {
                        if attempt == 0 {
                            info!("[lrclib] Status {status}; retrying");
                        }
                        retry_after
                    }
                    _ => {
                        warn!("[lrclib] Unexpected status {status}");
                        return Err("LRCLIB is unavailable. Retry analysis later.".into());
                    }
                }
            }
        };
        if attempt + 1 < attempts {
            let backoff = 1u64 << attempt.min(6);
            let seconds = backoff.max(retry_after.unwrap_or(0)).min(max_backoff);
            lrclib_backoff(Duration::from_secs(seconds), wait_for_retry)?;
        }
    }

    warn!("[lrclib] Giving up after {attempts} attempts");
    Err("LRCLIB is unavailable. Retry analysis later.".into())
}

/// Sleeps in slices so that cancelling a waiting analysis takes effect promptly.
fn lrclib_backoff(
    delay: Duration,
    wait_for_retry: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<(), String> {
    let until = Instant::now() + delay;
    while let Some(left) = until.checked_duration_since(Instant::now()) {
        if let Some(wait) = wait_for_retry {
            wait()?;
        }
        std::thread::sleep(left.min(LRCLIB_BACKOFF_SLICE));
    }
    Ok(())
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

fn search_lrclib(
    song: LrclibSong<'_>,
    title_only: bool,
    wait_for_retry: Option<&dyn Fn() -> Result<(), String>>,
) -> Result<Vec<LrclibCandidate>, String> {
    let mut url = format!(
        "https://lrclib.net/api/search?track_name={}",
        urlencoding::encode(song.title),
    );
    if !title_only {
        url.push_str("&artist_name=");
        url.push_str(&urlencoding::encode(song.artist));
    }
    std::thread::sleep(Duration::from_millis(300));
    Ok(lrclib_request::<Vec<LrclibCandidate>>(&url, wait_for_retry)?.unwrap_or_default())
}

fn pick_timed_lyrics(song: LrclibSong<'_>, results: &[LrclibCandidate]) -> Option<TimedLyrics> {
    results
        .iter()
        .filter_map(|candidate| {
            valid_timed_candidate(song, candidate).map(|parsed| {
                let album_match = fold_name(&candidate.album_name) == fold_name(song.album);
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

pub(crate) fn fetch_lrclib_timed_lyrics(
    song: &Song,
    wait_for_retry: &dyn Fn() -> Result<(), String>,
) -> Result<TimedLyrics, String> {
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

    find_timed_lyrics(
        LrclibSong::from(song),
        Some(wait_for_retry),
        crate::youtube_import::is_imported(song),
    )?
    .ok_or_else(|| {
        "No matching synchronized lyrics found on LRCLIB. Provide timed LRC manually.".into()
    })
}

/// The LRC analysis would use for this song: the release of the same length,
/// otherwise, with `other_releases`, the closest one.
pub(crate) fn find_timed_lyrics(
    song: LrclibSong<'_>,
    wait_for_retry: Option<&dyn Fn() -> Result<(), String>>,
    other_releases: bool,
) -> Result<Option<TimedLyrics>, String> {
    if (1.0..=3600.0).contains(&song.duration_secs) {
        std::thread::sleep(Duration::from_millis(300));
        let url = format!(
            "https://lrclib.net/api/get?track_name={}&artist_name={}&duration={}",
            urlencoding::encode(song.title),
            urlencoding::encode(song.artist),
            song.duration_secs.round(),
        );
        if let Some(candidate) = lrclib_request::<LrclibCandidate>(&url, wait_for_retry)?
            && let Some(parsed) = valid_timed_candidate(song, &candidate)
        {
            return Ok(Some(parsed));
        }
    }

    let results = search_lrclib(song, false, wait_for_retry)?;
    if let Some(parsed) = pick_timed_lyrics(song, &results) {
        return Ok(Some(parsed));
    }

    let title_results = search_lrclib(song, true, wait_for_retry)?;
    if let Some(parsed) = pick_timed_lyrics(song, &title_results) {
        return Ok(Some(parsed));
    }

    Ok(other_releases
        .then(|| pick_shifted_lyrics(song, results.iter().chain(&title_results)))
        .flatten())
}

/// LRC from another release of the same song (a music video with a longer
/// intro, a live cut), closest in length: its own timings must fit its own
/// duration, and the analyzer later finds where they fall in this recording.
/// Word timings are dropped because they would need the same shift.
fn pick_shifted_lyrics<'a>(
    song: LrclibSong<'_>,
    results: impl Iterator<Item = &'a LrclibCandidate>,
) -> Option<TimedLyrics> {
    results
        .filter(|candidate| {
            fold_name(song.title) == fold_name(&candidate.track_name)
                && fold_name(song.artist) == fold_name(&candidate.artist_name)
                && candidate.duration_secs.is_finite()
                && candidate.duration_secs > 0.0
        })
        .filter_map(|candidate| {
            let parsed = lrc::parse_lrc(candidate.synced_lyrics.as_deref()?).ok()?;
            let max_time = candidate.duration_secs + 2.0;
            parsed
                .segments
                .iter()
                .all(|segment| {
                    segment.start.is_finite()
                        && segment.end.is_finite()
                        && segment.start <= max_time
                        && segment.end > segment.start
                })
                .then_some((candidate.duration_secs, parsed))
        })
        .min_by(|a, b| {
            (song.duration_secs - a.0)
                .abs()
                .total_cmp(&(song.duration_secs - b.0).abs())
        })
        .map(|(duration_secs, parsed)| TimedLyrics {
            parsed,
            lyricsfile: None,
            other_release_secs: Some(duration_secs),
        })
}

fn valid_timed_candidate(song: LrclibSong<'_>, candidate: &LrclibCandidate) -> Option<TimedLyrics> {
    if fold_name(song.title) != fold_name(&candidate.track_name)
        || fold_name(song.artist) != fold_name(&candidate.artist_name)
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
            other_release_secs: None,
        })
}

pub(crate) fn lrclib_candidates(song: &Song) -> Vec<LrclibCandidate> {
    if song.title.trim().is_empty() {
        return Vec::new();
    }

    let mut results = if song.artist.trim().is_empty() || song.artist == "Unknown Artist" {
        Vec::new()
    } else {
        search_lrclib(song.into(), false, None).unwrap_or_else(|error| {
            warn!("[lrclib] Artist search failed: {error}");
            Vec::new()
        })
    };
    match search_lrclib(song.into(), true, None) {
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

/// Read-only lookup of a sidecar LRC next to a local song's audio. Nothing is
/// written; the editor decides whether to save the text. Remote origins point
/// `Song.path` at a cache placeholder and USDX songs at their descriptor, so
/// both are skipped. Any failure is treated as "no sidecar".
pub fn load_sidecar_lrc(file_hash: &str) -> Option<SidecarLrc> {
    let song = library_db::load_song_by_hash(file_hash).ok().flatten()?;
    if !matches!(song.origin, SongOrigin::LocalFile) || song.usdx.is_some() {
        return None;
    }

    let parent = song.path.parent()?;
    let stem = song.path.file_stem()?.to_str()?;
    let (path, kind) = find_sidecar(parent, stem)?;

    // A symlinked sidecar must not read outside the song's own directory.
    let canonical_parent = parent.canonicalize().ok()?;
    let canonical_file = path.canonicalize().ok()?;
    if canonical_file.parent()? != canonical_parent.as_path() {
        return None;
    }

    let metadata = std::fs::metadata(&canonical_file).ok()?;
    if !metadata.is_file() || metadata.len() > SIDECAR_LRC_MAX_BYTES {
        return None;
    }

    let bytes = std::fs::read(&canonical_file).ok()?;
    let text = normalize_newlines(&decode_text(&bytes));
    if text.trim().is_empty() {
        return None;
    }

    Some(SidecarLrc {
        text,
        file_name: path.file_name()?.to_str()?.to_string(),
        kind,
    })
}

/// Windows LRC tools commonly write CRLF; the raw text lands in the editor and
/// is sent back on save, so stray returns are normalised here.
fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn match_sidecar_name(name: &str, stem: &str) -> Option<(SidecarLrcKind, bool)> {
    let path = Path::new(name);
    let ext = path.extension()?.to_str()?;
    let kind = if ext.eq_ignore_ascii_case("lrc") {
        SidecarLrcKind::Lrc
    } else if ext.eq_ignore_ascii_case("elrc") {
        SidecarLrcKind::Elrc
    } else {
        return None;
    };
    let file_stem = path.file_stem()?.to_str()?;
    if !file_stem.eq_ignore_ascii_case(stem) {
        return None;
    }
    let exact = file_stem == stem && ext == kind.extension();
    Some((kind, exact))
}

/// Case-insensitive sibling lookup so `Song.LRC` still matches on
/// case-sensitive filesystems. Exact-case names win, then `.lrc` over `.elrc`,
/// then name order so `read_dir` ordering never changes the result.
fn find_sidecar(parent: &Path, stem: &str) -> Option<(PathBuf, SidecarLrcKind)> {
    let mut best: Option<((bool, u8, String), PathBuf, SidecarLrcKind)> = None;
    for entry in std::fs::read_dir(parent).ok()?.flatten() {
        let name_os = entry.file_name();
        let Some(name) = name_os.to_str() else {
            continue;
        };
        let Some((kind, exact)) = match_sidecar_name(name, stem) else {
            continue;
        };
        // `metadata` follows symlinks; the caller's canonicalize check keeps
        // the target inside the song's directory.
        let path = entry.path();
        if !std::fs::metadata(&path).is_ok_and(|m| m.is_file()) {
            continue;
        }
        let key = (!exact, kind.rank(), name.to_string());
        if best.as_ref().is_none_or(|(current, _, _)| key < *current) {
            best = Some((key, path, kind));
        }
    }
    best.map(|(_, path, kind)| (path, kind))
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

    store_lyrics_and_realign(
        file_hash,
        &LyricsFile {
            lines: normalized,
            windows: None,
        },
    )
}

/// Save line-timed LRC and realign it: each line keeps its LRC timing as a
/// window and alignment only times the words inside it.
pub fn align_lrc_lyrics(file_hash: &str, lrc_text: &str) -> Result<(), String> {
    if is_usdx_song(file_hash) {
        return Err("Cannot edit lyrics for USDX songs".to_string());
    }

    let parsed = lrc::parse_lrc(lrc_text)?;
    let (lines, windows) = parsed
        .segments
        .iter()
        .map(|segment| {
            (
                segment.text.clone(),
                LineWindow {
                    start: segment.start,
                    end: segment.end,
                },
            )
        })
        .unzip();

    store_lyrics_and_realign(
        file_hash,
        &LyricsFile {
            lines,
            windows: Some(windows),
        },
    )
}

fn store_lyrics_and_realign(file_hash: &str, lyrics: &LyricsFile) -> Result<(), String> {
    let cache = CacheDir::new();
    let previous_language = library_db::load_song_by_hash(file_hash)
        .ok()
        .flatten()
        .and_then(|song| song.language);
    write_lyrics_json(&cache, file_hash, lyrics)
        .map_err(|e| format!("Failed to write lyrics file: {e}"))?;

    let _ = std::fs::remove_file(cache.transcript_path(file_hash));
    cache.delete_transcript_variants(file_hash);

    update_song_analyzed(file_hash, false, previous_language, None, None, None);
    enqueue_one(file_hash)?;
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
    timed: &TimedLyrics,
) -> Result<(), String> {
    let mut value = build_lrc_transcript(&timed.parsed, song.language.as_deref(), None, 1.0, false);
    value["source"] = serde_json::json!("lrclib_pending");
    if let Some(release_secs) = timed.other_release_secs {
        let seconds = ((song.duration_secs - release_secs).abs() + SHIFT_SEARCH_MARGIN_SECONDS)
            .clamp(MIN_SHIFT_SEARCH_SECONDS, MAX_SHIFT_SEARCH_SECONDS);
        value["lrc_shift_search_secs"] = serde_json::json!(seconds);
    }
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
        enqueue_one(file_hash)?;
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
    lyrics: &LyricsFile,
) -> std::io::Result<PathBuf> {
    write_lyrics_json(cache, file_hash, lyrics)
}

fn write_lyrics_json(
    cache: &CacheDir,
    file_hash: &str,
    lyrics: &LyricsFile,
) -> std::io::Result<PathBuf> {
    let out = cache.lyrics_path(file_hash);
    let json = serde_json::to_vec_pretty(lyrics).map_err(std::io::Error::other)?;
    std::fs::write(&out, json)?;
    Ok(out)
}
