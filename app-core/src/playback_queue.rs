use std::collections::VecDeque;
use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::{Song, SongsStore};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackQueueEntry {
    pub id: String,
    pub song: Song,
    pub tempo: f64,
    pub key_offset: i32,
}

#[derive(Debug, Default)]
pub struct PlaybackQueue {
    entries: Mutex<VecDeque<PlaybackQueueEntry>>,
    next_id: AtomicU64,
}

/// Replaces each entry's song with its current library row so analysis that
/// finished after the song was queued is visible to callers.
fn refreshed(entries: &mut VecDeque<PlaybackQueueEntry>) -> Vec<PlaybackQueueEntry> {
    let hashes: Vec<String> = entries
        .iter()
        .map(|entry| entry.song.file_hash.clone())
        .collect();
    let songs = SongsStore::load_by_hashes(&hashes);
    for entry in entries.iter_mut() {
        if let Some(song) = songs
            .iter()
            .find(|song| song.file_hash == entry.song.file_hash && song.path == entry.song.path)
        {
            entry.song = song.clone();
        }
    }
    entries.iter().cloned().collect()
}

impl PlaybackQueue {
    pub fn entries(&self) -> Result<Vec<PlaybackQueueEntry>, String> {
        self.entries
            .lock()
            .map(|mut entries| refreshed(&mut entries))
            .map_err(|_| "playback queue lock poisoned".to_string())
    }

    pub fn add(
        &self,
        file_hash: &str,
        tempo: f64,
        key_offset: i32,
    ) -> Result<Vec<PlaybackQueueEntry>, String> {
        let song = SongsStore::load_by_hashes(&[file_hash.to_string()])
            .into_iter()
            .next()
            .ok_or_else(|| "song not found".to_string())?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "playback queue lock poisoned".to_string())?;

        entries.push_back(PlaybackQueueEntry {
            id,
            song,
            tempo,
            key_offset,
        });

        Ok(refreshed(&mut entries))
    }

    pub fn move_entry(
        &self,
        id: &str,
        target_index: usize,
    ) -> Result<Vec<PlaybackQueueEntry>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "playback queue lock poisoned".to_string())?;
        let source_index = entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| "queue entry not found".to_string())?;

        if target_index >= entries.len() {
            return Err("queue position out of range".to_string());
        }

        let entry = entries
            .remove(source_index)
            .ok_or_else(|| "queue entry not found".to_string())?;
        let target_index = target_index.min(entries.len());
        entries.insert(target_index, entry);

        Ok(refreshed(&mut entries))
    }

    pub fn remove(&self, id: &str) -> Result<Vec<PlaybackQueueEntry>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "playback queue lock poisoned".to_string())?;

        entries.retain(|entry| entry.id != id);

        Ok(refreshed(&mut entries))
    }

    pub fn remove_song_path(&self, path: &Path) -> Result<Vec<PlaybackQueueEntry>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "playback queue lock poisoned".to_string())?;
        entries.retain(|entry| entry.song.path != path);
        Ok(refreshed(&mut entries))
    }

    pub fn clear(&self) -> Result<Vec<PlaybackQueueEntry>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "playback queue lock poisoned".to_string())?;

        entries.clear();

        Ok(Vec::new())
    }
}
