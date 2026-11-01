//! Imports a YouTube music video as a local-library video song. The clip is
//! saved under `<library>/YouTube/`, analysed ahead of the rest of the analysis
//! queue, and handed to the caller once it is in the library.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::analyzer;
use crate::cache::{CacheDir, videos_dir};
use crate::config::{AppConfig, LibrarySource};
use crate::library_db;
use crate::lyrics::{LrclibSong, find_timed_lyrics};
use crate::song::{Song, build_song};
use crate::song_video::worker::{self, Access};
use crate::song_video::{DownloadDirectory, search_videos, valid_video_id};

const LIBRARY_SUBFOLDER: &str = "YouTube";
const MAX_ACTIVE_JOBS: usize = 5;
const KEPT_JOBS: usize = 20;
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 120;
/// Up to here LRC from another release still lands after moving it as a whole
/// (a longer intro in the video); beyond it the recording is a different cut.
const CRITICAL_RELEASE_DIFFERENCE_SECS: f64 = 30.0;
const NOISE_WORDS: &[&str] = &[
    "official",
    "video",
    "clip",
    "клип",
    "audio",
    "lyric",
    "hd",
    "4k",
    "mv",
    "премьера",
    "visualizer",
    "remaster",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration_sec: Option<f64>,
    pub suggested_artist: String,
    pub suggested_title: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ImportState {
    Waiting,
    Downloading,
    Saving,
    #[serde(rename_all = "camelCase")]
    Done {
        file_hash: String,
    },
    Failed {
        error: String,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJob {
    pub id: String,
    pub video_id: String,
    pub artist: String,
    pub title: String,
    #[serde(flatten)]
    pub state: ImportState,
}

impl ImportJob {
    fn active(&self) -> bool {
        matches!(
            self.state,
            ImportState::Waiting | ImportState::Downloading | ImportState::Saving
        )
    }
}

pub fn search_youtube(query: &str) -> Result<Vec<ImportCandidate>, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 300 {
        return Err("Search text must be 1-300 characters".into());
    }
    Ok(search_videos(query)?
        .into_iter()
        .map(|candidate| {
            let (suggested_artist, suggested_title) =
                suggest_metadata(&candidate.title, &candidate.channel);
            ImportCandidate {
                id: candidate.id,
                title: candidate.title,
                channel: candidate.channel,
                duration_sec: candidate.duration_sec,
                suggested_artist,
                suggested_title,
            }
        })
        .collect())
}

/// A check can take a minute while LRCLIB is overloaded; these slots keep the
/// remote's other requests served while someone edits the artist and title.
static LYRICS_CHECK_SLOTS: [Mutex<()>; 2] = [Mutex::new(()), Mutex::new(())];

/// What analysis of a clip would find on LRCLIB, known before downloading it.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ImportLyricsCheck {
    /// Timed lyrics fit the clip, or exist when the clip's length is unknown.
    Match,
    #[serde(rename_all = "camelCase")]
    OtherRelease {
        lyrics_duration_sec: f64,
        critical: bool,
    },
    /// Analysis would stop: there are no timed lyrics to align.
    Missing,
}

pub fn check_import_lyrics(
    artist: &str,
    title: &str,
    duration_sec: Option<f64>,
) -> Result<ImportLyricsCheck, String> {
    let artist = clean_field(artist, "Artist")?;
    let title = clean_field(title, "Title")?;
    let _slot = LYRICS_CHECK_SLOTS
        .iter()
        .find_map(|slot| slot.try_lock().ok())
        .ok_or_else(|| "Too many lyrics checks are running".to_string())?;
    let duration = duration_sec.filter(|seconds| seconds.is_finite() && *seconds > 0.0);
    let song = LrclibSong {
        title: &title,
        artist: &artist,
        album: "",
        duration_secs: duration.unwrap_or(0.0),
    };
    Ok(match find_timed_lyrics(song, None, true)? {
        None => ImportLyricsCheck::Missing,
        Some(lyrics) => match (duration, lyrics.other_release_secs) {
            (Some(clip_secs), Some(lyrics_secs)) => ImportLyricsCheck::OtherRelease {
                lyrics_duration_sec: lyrics_secs,
                critical: (clip_secs - lyrics_secs).abs() > CRITICAL_RELEASE_DIFFERENCE_SECS,
            },
            _ => ImportLyricsCheck::Match,
        },
    })
}

fn is_noise(group: &str) -> bool {
    let lower = group.to_lowercase();
    lower
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| NOISE_WORDS.contains(&word))
}

fn strip_noise(title: &str) -> String {
    let mut out = String::new();
    let mut rest = title;
    while let Some(start) = rest.find(['(', '[']) {
        let close = if rest[start..].starts_with('(') {
            ')'
        } else {
            ']'
        };
        let Some(length) = rest[start..].find(close) else {
            break;
        };
        let group = &rest[start..=start + length];
        out.push_str(&rest[..start]);
        if close == ')' && !is_noise(group) {
            out.push_str(group);
        }
        rest = &rest[start + length + 1..];
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn unquote(value: &str) -> String {
    value
        .trim()
        .trim_matches(|c| matches!(c, '"' | '«' | '»' | '“' | '”'))
        .trim()
        .to_string()
}

/// Splits a video title such as `Artist - Title (Official Video)` into an
/// editable artist/title suggestion; the channel stands in for a missing artist.
fn suggest_metadata(video_title: &str, channel: &str) -> (String, String) {
    let cleaned = strip_noise(video_title);
    for separator in [" - ", " — ", " – ", " | "] {
        if let Some((artist, title)) = cleaned.split_once(separator)
            && !artist.trim().is_empty()
            && !title.trim().is_empty()
        {
            return (unquote(artist), unquote(title));
        }
    }
    let artist = channel
        .trim()
        .trim_end_matches(" - Topic")
        .trim_end_matches("VEVO")
        .trim();
    (artist.to_string(), unquote(&cleaned))
}

fn clean_field(value: &str, label: &str) -> Result<String, String> {
    let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || value.chars().count() > 200 || value.chars().any(char::is_control) {
        return Err(format!("{label} must be 1-200 characters"));
    }
    Ok(value)
}

fn library_root() -> Result<PathBuf, String> {
    let Some(LibrarySource::Folder { path }) = AppConfig::load().library_source else {
        return Err("YouTube import needs a local-folder library".into());
    };
    path.canonicalize()
        .map_err(|_| "Cannot resolve the local library folder".to_string())
}

fn import_directory(root: &Path) -> Result<PathBuf, String> {
    let directory = root.join(LIBRARY_SUBFOLDER);
    match std::fs::create_dir(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err("Cannot create the YouTube folder in the library".into()),
    }
    let metadata = std::fs::symlink_metadata(&directory)
        .map_err(|_| "Cannot inspect the YouTube library folder".to_string())?;
    let directory = directory
        .canonicalize()
        .map_err(|_| "Cannot resolve the YouTube library folder".to_string())?;
    if !metadata.is_dir() || !directory.starts_with(root) {
        return Err("The YouTube library folder is not a folder inside the library".into());
    }
    Ok(directory)
}

fn file_stem(artist: &str, title: &str) -> String {
    let name: String = format!("{artist} - {title}")
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                ' '
            } else {
                c
            }
        })
        .collect();
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    name.trim_start_matches('.')
        .chars()
        .take(MAX_NAME_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

fn video_suffix(video_id: &str) -> String {
    format!(" [{video_id}].mp4")
}

/// Imported files carry their YouTube id as ` [<id>].mp4`, which identifies
/// the video without reading the file.
fn video_in_library(directory: &Path, video_id: &str) -> Result<bool, String> {
    let suffix = video_suffix(video_id);
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("Cannot list the YouTube library folder".into()),
    };
    Ok(entries.filter_map(Result::ok).any(|entry| {
        entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.ends_with(&suffix))
    }))
}

fn target_path(
    directory: &Path,
    artist: &str,
    title: &str,
    video_id: &str,
) -> Result<PathBuf, String> {
    if video_in_library(directory, video_id)? {
        return Err("This video is already in the library".into());
    }
    let stem = file_stem(artist, title);
    let stem = if stem.is_empty() {
        video_id.to_string()
    } else {
        stem
    };
    Ok(directory.join(format!("{stem}{}", video_suffix(video_id))))
}

/// True for a song that YouTube import saved into the library.
pub(crate) fn is_imported(song: &Song) -> bool {
    let named_by_import = song
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_suffix("].mp4"))
        .and_then(|name| name.rsplit_once(" ["))
        .is_some_and(|(_, id)| valid_video_id(id));
    named_by_import
        && library_root().is_ok_and(|root| {
            song.path
                .parent()
                .and_then(|parent| parent.canonicalize().ok())
                .is_some_and(|parent| parent == root.join(LIBRARY_SUBFOLDER))
        })
}

struct PartialFile(Option<PathBuf>);

impl Drop for PartialFile {
    fn drop(&mut self) {
        if let Some(path) = &self.0
            && let Err(error) = std::fs::remove_file(path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!("[youtube-import] Cannot remove an incomplete library file");
        }
    }
}

fn save_clip(clip: &Path, directory: &Path, job: &ImportJob) -> Result<PathBuf, String> {
    let size = std::fs::metadata(clip)
        .map_err(|_| "The downloaded video is missing".to_string())?
        .len();
    if size == 0 || size > MAX_FILE_BYTES {
        return Err("The downloaded video exceeds the 512 MiB limit".into());
    }
    let partial = directory.join(format!(".nightingale-{:016x}.part", rand::random::<u64>()));
    let mut cleanup = PartialFile(Some(partial.clone()));
    let status = crate::vendor::silent_command(crate::vendor::ffmpeg_path())
        .arg("-nostdin")
        .args(["-v", "error", "-i"])
        .arg(clip)
        .args(["-map", "0:v:0", "-map", "0:a:0", "-c", "copy"])
        .arg("-metadata")
        .arg(format!("artist={}", job.artist))
        .arg("-metadata")
        .arg(format!("title={}", job.title))
        .arg("-metadata:s:a:0")
        .arg(format!("title={}", job.title))
        .args(["-movflags", "+faststart", "-f", "mp4"])
        .arg(&partial)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "Cannot start ffmpeg to save the video".to_string())?;
    if !status.success() {
        return Err("ffmpeg could not save the video".into());
    }
    let target = target_path(directory, &job.artist, &job.title, &job.video_id)?;
    std::fs::rename(&partial, &target)
        .map_err(|_| "Cannot move the video into the library".to_string())?;
    cleanup.0 = None;
    Ok(target)
}

/// Video tags are read from the audio stream, which MP4 cannot carry, so the
/// confirmed artist and title are applied to the library row directly.
fn add_to_library(path: &Path, job: &ImportJob) -> Result<Song, String> {
    let mut song = build_song(path, &CacheDir::new(), true)
        .map_err(|_| "Cannot read the saved video".to_string())?;
    song.artist.clone_from(&job.artist);
    song.title.clone_from(&job.title);
    library_db::insert_song(&song).map_err(|_| "Cannot add the song to the library".to_string())?;
    if let Ok((label, count)) = library_db::read_library_meta() {
        let _ = library_db::update_library_meta(&label, count + 1);
    }
    analyzer::enqueue_first(&song.file_hash)?;
    Ok(song)
}

pub struct YoutubeImports {
    jobs: Arc<Mutex<VecDeque<ImportJob>>>,
    sender: Mutex<Sender<ImportJob>>,
    next_id: AtomicU64,
}

impl YoutubeImports {
    /// Starts the import worker. `on_imported` runs on the worker thread for
    /// each song that reached the library.
    pub fn start(on_imported: impl Fn(&Song) + Send + 'static) -> Self {
        let jobs = Arc::new(Mutex::new(VecDeque::new()));
        let (sender, receiver) = channel();
        let worker_jobs = Arc::clone(&jobs);
        std::thread::spawn(move || run_worker(&receiver, &worker_jobs, &on_imported));
        Self {
            jobs,
            sender: Mutex::new(sender),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn jobs(&self) -> Vec<ImportJob> {
        lock(&self.jobs).iter().cloned().collect()
    }

    pub fn import(
        &self,
        video_id: &str,
        artist: &str,
        title: &str,
    ) -> Result<Vec<ImportJob>, String> {
        if !valid_video_id(video_id) {
            return Err("Invalid YouTube video identifier".into());
        }
        let job = ImportJob {
            id: self.next_id.fetch_add(1, Ordering::Relaxed).to_string(),
            video_id: video_id.to_string(),
            artist: clean_field(artist, "Artist")?,
            title: clean_field(title, "Title")?,
            state: ImportState::Waiting,
        };
        if video_in_library(&library_root()?.join(LIBRARY_SUBFOLDER), video_id)? {
            return Err("This video is already in the library".into());
        }
        let mut jobs = lock(&self.jobs);
        let active: Vec<_> = jobs.iter().filter(|job| job.active()).collect();
        if active
            .iter()
            .any(|existing| existing.video_id == job.video_id)
        {
            return Err("This video is already being imported".into());
        }
        if active.len() >= MAX_ACTIVE_JOBS {
            return Err("Too many imports are waiting; try again later".into());
        }
        lock(&self.sender)
            .send(job.clone())
            .map_err(|_| "The import worker has stopped".to_string())?;
        jobs.push_front(job);
        while jobs.len() > KEPT_JOBS {
            let Some(index) = jobs.iter().rposition(|job| !job.active()) else {
                break;
            };
            jobs.remove(index);
        }
        Ok(jobs.iter().cloned().collect())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn set_state(jobs: &Mutex<VecDeque<ImportJob>>, id: &str, state: ImportState) {
    if let Some(job) = lock(jobs).iter_mut().find(|job| job.id == id) {
        job.state = state;
    }
}

fn run_worker(
    receiver: &Receiver<ImportJob>,
    jobs: &Mutex<VecDeque<ImportJob>>,
    on_imported: &impl Fn(&Song),
) {
    while let Ok(job) = receiver.recv() {
        match import_one(&job, jobs) {
            Ok(song) => {
                set_state(
                    jobs,
                    &job.id,
                    ImportState::Done {
                        file_hash: song.file_hash.clone(),
                    },
                );
                on_imported(&song);
            }
            Err(error) => {
                tracing::warn!("[youtube-import] Import failed: {error}");
                set_state(jobs, &job.id, ImportState::Failed { error });
            }
        }
    }
}

fn import_one(job: &ImportJob, jobs: &Mutex<VecDeque<ImportJob>>) -> Result<Song, String> {
    set_state(jobs, &job.id, ImportState::Downloading);
    let directory = import_directory(&library_root()?)?;
    let downloads = videos_dir().join("import");
    std::fs::create_dir_all(&downloads)
        .map_err(|_| "Cannot prepare the video download".to_string())?;
    let pending = downloads.join(format!("{:016x}", rand::random::<u64>()));
    std::fs::create_dir(&pending).map_err(|_| "Cannot prepare the video download".to_string())?;
    let _cleanup = DownloadDirectory(Some(pending.clone()));
    worker::run(
        serde_json::json!({
            "action": "import", "video_id": job.video_id,
            "directory": pending, "ffmpeg": crate::vendor::ffmpeg_path(),
        }),
        900,
        Access::QueuedDownload,
    )?;
    set_state(jobs, &job.id, ImportState::Saving);
    let path = save_clip(&pending.join("clip.mp4"), &directory, job)?;
    add_to_library(&path, job)
}
