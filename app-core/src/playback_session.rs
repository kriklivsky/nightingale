use std::collections::HashSet;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Song;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PlayerColor {
    #[default]
    Rose,
    Fuchsia,
    Amber,
    Emerald,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlaybackPlayer {
    pub id: String,
    pub profile: Option<String>,
    pub microphone_id: String,
    #[serde(default)]
    pub color: PlayerColor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub song: Song,
    pub queue_playback: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playback_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub players: Vec<PlaybackPlayer>,
}

impl PlaybackSession {
    fn validate(&self) -> Result<(), String> {
        if self.players.is_empty() {
            return Ok(());
        }
        if !(2..=4).contains(&self.players.len()) {
            return Err("multiplayer playback requires two to four players".to_string());
        }

        let mut ids = HashSet::new();
        let mut microphones = HashSet::new();
        let mut profiles = HashSet::new();
        for player in &self.players {
            if player.id.is_empty() || !ids.insert(player.id.as_str()) {
                return Err("multiplayer player IDs must be unique".to_string());
            }
            if player.microphone_id.is_empty() || !microphones.insert(player.microphone_id.as_str())
            {
                return Err("each multiplayer player needs a unique microphone".to_string());
            }
            if let Some(profile) = player.profile.as_deref()
                && (profile.is_empty() || !profiles.insert(profile))
            {
                return Err("saved profiles cannot be reused in multiplayer".to_string());
            }
        }

        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct PlaybackSessionStore {
    session: Mutex<Option<PlaybackSession>>,
}

impl PlaybackSessionStore {
    pub fn load(&self) -> Result<Option<PlaybackSession>, String> {
        self.session
            .lock()
            .map(|session| session.clone())
            .map_err(|_| "playback session lock poisoned".to_string())
    }

    pub fn save(&self, session: PlaybackSession) -> Result<PlaybackSession, String> {
        session.validate()?;
        let mut current = self
            .session
            .lock()
            .map_err(|_| "playback session lock poisoned".to_string())?;
        *current = Some(session.clone());
        Ok(session)
    }
}
