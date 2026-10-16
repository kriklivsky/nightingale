mod worker;

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::cache::videos_dir;
use crate::config::{AppConfig, LibrarySource};
use crate::library_db;
use crate::song::{Song, SongOrigin};

static VIDEO_WRITE: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SongVideo {
    pub video_id: String,
    pub title: String,
    pub offset_sec: f64,
    pub audio_matched: bool,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VideoCandidate {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration_sec: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Selection {
    video_id: String,
    title: String,
    offset_sec: f64,
    audio_matched: bool,
    directory: String,
}

fn valid_id(value: &str, length: usize, hex: bool) -> bool {
    value.len() == length
        && value.bytes().all(|byte| {
            if hex {
                byte.is_ascii_hexdigit()
            } else {
                byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
            }
        })
}

fn load_song(file_hash: &str) -> Result<Song, String> {
    if !valid_id(file_hash, 32, true) {
        return Err("Invalid song identifier".into());
    }
    library_db::load_song_by_hash(file_hash)
        .map_err(|_| "Cannot read song library".to_string())?
        .ok_or_else(|| "Song is no longer in the library".into())
}

fn directory(file_hash: &str) -> Result<PathBuf, String> {
    let root = videos_dir();
    std::fs::create_dir_all(&root).map_err(|_| "Cannot create video cache".to_string())?;
    let root = root
        .canonicalize()
        .map_err(|_| "Cannot resolve video cache".to_string())?;
    let mut parent = root.clone();
    for name in ["youtube", file_hash] {
        let child = parent.join(name);
        match std::fs::create_dir(&child) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err("Cannot create song video cache".into()),
        }
        parent = child
            .canonicalize()
            .map_err(|_| "Cannot resolve song video cache".to_string())?;
        if !parent.starts_with(&root) {
            return Err("Song video cache is outside the configured cache root".into());
        }
    }
    Ok(parent)
}

fn read_selection(directory: &Path) -> Result<Option<Selection>, String> {
    let path = directory.join("selection.json");
    if let Ok(metadata) = std::fs::symlink_metadata(&path)
        && !metadata.is_file()
    {
        return Err("Invalid saved video selection file".into());
    }
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read saved video selection".into()),
    };
    let mut bytes = Vec::new();
    file.take(8193)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read saved video selection".to_string())?;
    if bytes.len() > 8192 {
        return Err("Saved video selection is too large".into());
    }
    let selection: Selection =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid saved video selection".to_string())?;
    if !valid_id(&selection.video_id, 11, false)
        || !valid_id(&selection.directory, 16, true)
        || !selection.offset_sec.is_finite()
        || selection.offset_sec.abs() > 600.0
        || selection.title.len() > 1200
    {
        return Err("Invalid saved video selection".into());
    }
    Ok(Some(selection))
}

fn write_selection(directory: &Path, selection: &Selection) -> Result<(), String> {
    let temporary = directory.join(format!("selection-{:016x}.tmp", rand::random::<u64>()));
    let result = (|| {
        let bytes = serde_json::to_vec(selection)
            .map_err(|_| "Cannot encode video selection".to_string())?;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "Cannot save video selection".to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| "Cannot save video selection".to_string())?;
        std::fs::rename(&temporary, directory.join("selection.json"))
            .map_err(|_| "Cannot commit video selection".to_string())
    })();
    if result.is_err()
        && let Err(error) = std::fs::remove_file(&temporary)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        tracing::warn!("[song-video] Cannot clean up incomplete video selection");
    }
    result
}

fn as_video(directory: &Path, selection: Selection) -> Result<SongVideo, String> {
    let path = directory
        .join(&selection.directory)
        .join("clip.mp4")
        .canonicalize()
        .map_err(|_| "Downloaded video is missing; download it again".to_string())?;
    if !path.starts_with(directory) || !path.is_file() {
        return Err("Invalid downloaded video path".into());
    }
    Ok(SongVideo {
        video_id: selection.video_id,
        title: selection.title,
        offset_sec: selection.offset_sec,
        audio_matched: selection.audio_matched,
        path: path.to_string_lossy().into_owned(),
    })
}

pub fn get_song_video(file_hash: &str) -> Result<Option<SongVideo>, String> {
    load_song(file_hash)?;
    let directory = directory(file_hash)?;
    read_selection(&directory)?
        .map(|selection| as_video(&directory, selection))
        .transpose()
}

pub fn search_song_videos(
    file_hash: &str,
    title_only: bool,
) -> Result<Vec<VideoCandidate>, String> {
    let song = load_song(file_hash)?;
    let query = if title_only {
        song.title.clone()
    } else {
        format!("{} {}", song.artist, song.title)
    };
    if query.trim().is_empty() || query.chars().count() > 300 {
        return Err("Song title/artist is empty or too long for YouTube search".into());
    }
    let result = worker::run(
        serde_json::json!({ "action": "search", "query": query }),
        90,
    )?;
    let mut candidates: Vec<VideoCandidate> =
        serde_json::from_value(result.get("candidates").cloned().unwrap_or_default())
            .map_err(|_| "YouTube returned invalid search results".to_string())?;
    candidates.retain(|candidate| {
        valid_id(&candidate.id, 11, false)
            && candidate.title.len() <= 1200
            && candidate.channel.len() <= 1200
            && candidate
                .duration_sec
                .is_none_or(|duration| duration.is_finite() && duration > 0.0 && duration <= 1200.0)
    });
    candidates.truncate(8);
    candidates.sort_by(|left, right| {
        let difference = |candidate: &VideoCandidate| {
            candidate.duration_sec.map_or(f64::INFINITY, |duration| {
                (duration - song.duration_secs).abs()
            })
        };
        difference(left).total_cmp(&difference(right))
    });
    Ok(candidates)
}

fn original_audio(song: &Song) -> Result<PathBuf, String> {
    let Some(LibrarySource::Folder { path }) = AppConfig::load().library_source else {
        return Err("Video synchronization currently requires a local-folder library".into());
    };
    if song.origin != SongOrigin::LocalFile {
        return Err("Video synchronization currently supports local songs only".into());
    }
    let root = path
        .canonicalize()
        .map_err(|_| "Cannot resolve local library".to_string())?;
    let audio = song
        .usdx
        .as_ref()
        .map_or(&song.path, |bundle| &bundle.audio)
        .canonicalize()
        .map_err(|_| "Original song audio is missing".to_string())?;
    if !audio.starts_with(root) || !audio.is_file() {
        return Err("Original audio is outside the local library".into());
    }
    Ok(audio)
}

struct DownloadDirectory(Option<PathBuf>);

impl Drop for DownloadDirectory {
    fn drop(&mut self) {
        if let Some(path) = &self.0
            && let Err(error) = std::fs::remove_dir_all(path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!("[song-video] Cannot clean up temporary video download");
        }
    }
}

pub fn download_song_video(file_hash: &str, video_id: &str) -> Result<SongVideo, String> {
    if !valid_id(video_id, 11, false) {
        return Err("Invalid YouTube video identifier".into());
    }
    let _guard = VIDEO_WRITE
        .try_lock()
        .map_err(|_| "Another video operation is running; wait for it to finish".to_string())?;
    let song = load_song(file_hash)?;
    let audio = original_audio(&song)?;
    let directory = directory(file_hash)?;
    let name = format!("{:016x}", rand::random::<u64>());
    let pending = directory.join(&name);
    std::fs::create_dir(&pending).map_err(|_| "Cannot prepare video download".to_string())?;
    let mut cleanup = DownloadDirectory(Some(pending.clone()));
    let result = worker::run(
        serde_json::json!({
            "action": "download", "video_id": video_id,
            "directory": pending, "audio_path": audio, "ffmpeg": crate::vendor::ffmpeg_path(),
        }),
        900,
    )?;
    let title = result
        .get("title")
        .and_then(serde_json::Value::as_str)
        .filter(|title| title.len() <= 1200)
        .ok_or("Invalid downloaded video title")?
        .to_string();
    let offset = result
        .get("offset_sec")
        .and_then(serde_json::Value::as_f64)
        .filter(|offset| offset.is_finite() && offset.abs() <= 120.0);
    let selection = Selection {
        video_id: video_id.into(),
        title,
        offset_sec: offset.unwrap_or(0.0),
        audio_matched: offset.is_some(),
        directory: name,
    };
    let video = as_video(&directory, selection.clone())?;
    let bytes = std::fs::metadata(&video.path)
        .map_err(|_| "Cannot inspect downloaded video".to_string())?
        .len();
    if bytes == 0 || bytes > 512 * 1024 * 1024 {
        return Err("Downloaded video exceeds the 512 MiB limit".into());
    }
    let previous = read_selection(&directory)?;
    load_song(file_hash)?;
    write_selection(&directory, &selection)?;
    cleanup.0 = None;
    if let Some(previous) = previous {
        let old = directory.join(previous.directory);
        if old.is_dir()
            && !old.is_symlink()
            && let Err(_error) = std::fs::remove_dir_all(old)
        {
            tracing::warn!("[song-video] Cannot remove replaced cached video");
        }
    }
    Ok(video)
}

pub fn set_song_video_offset(file_hash: &str, offset_sec: f64) -> Result<SongVideo, String> {
    if !offset_sec.is_finite() || offset_sec.abs() > 600.0 {
        return Err("Video offset must be between -600 and +600 seconds".into());
    }
    let _guard = VIDEO_WRITE
        .try_lock()
        .map_err(|_| "A video operation is still running".to_string())?;
    load_song(file_hash)?;
    let directory = directory(file_hash)?;
    let mut selection = read_selection(&directory)?.ok_or("No downloaded video for this song")?;
    selection.offset_sec = offset_sec;
    selection.audio_matched = false;
    write_selection(&directory, &selection)?;
    as_video(&directory, selection)
}

pub fn remove_song_video(file_hash: &str) -> Result<(), String> {
    let _guard = VIDEO_WRITE
        .try_lock()
        .map_err(|_| "A video operation is still running".to_string())?;
    load_song(file_hash)?;
    let directory = directory(file_hash)?;
    if let Some(selection) = read_selection(&directory)? {
        std::fs::remove_file(directory.join("selection.json"))
            .map_err(|_| "Cannot remove video selection".to_string())?;
        let clip = directory.join(selection.directory);
        if clip.is_dir() && !clip.is_symlink() {
            std::fs::remove_dir_all(clip).map_err(|_| {
                "Video detached, but its cached download could not be removed".to_string()
            })?;
        }
    }
    Ok(())
}
