//! Phone control of the TV frontend: the frontend reports what it shows, and
//! validated phone commands are relayed to it as the `remote-command` event so
//! they run through the same actions as the TV remote.

use std::sync::Mutex;

use app_core::{AppConfig, PlaybackPlayer, ProfileStore};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::microphones::{list_microphones, MicrophoneInfo};

const COMMAND_EVENT: &str = "remote-command";
const MAX_SEEK_SECONDS: f64 = 60.0;

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "screen", rename_all = "camelCase")]
pub(crate) enum TvStatus {
    Menu,
    #[serde(rename_all = "camelCase")]
    Playback {
        file_hash: String,
        title: String,
        artist: String,
        ready: bool,
        paused: bool,
        result_open: bool,
        position_sec: f64,
        duration_sec: f64,
        output_volume: f64,
        guide_volume: f64,
        guide_available: bool,
        mic_enabled: bool,
        monitor_enabled: bool,
        multiplayer: bool,
        can_skip: bool,
    },
}

#[derive(Default)]
pub(crate) struct TvStatusState(Mutex<Option<TvStatus>>);

#[tauri::command]
pub(crate) fn report_remote_status(state: State<'_, TvStatusState>, status: TvStatus) {
    *super::lock(&state.0) = Some(status);
}

pub(super) fn current(state: &TvStatusState) -> Option<TvStatus> {
    super::lock(&state.0).clone()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum StartTarget {
    Queue,
    #[serde(rename_all = "camelCase")]
    Song {
        file_hash: String,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum StartMode {
    #[serde(rename_all = "camelCase")]
    Solo {
        microphone_id: Option<String>,
        profile: Option<String>,
    },
    Multiplayer {
        players: Vec<PlaybackPlayer>,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum RemoteCommand {
    Start {
        target: StartTarget,
        mode: StartMode,
    },
    Pause,
    Resume,
    Restart,
    Stop,
    Next,
    Background,
    ToggleMic,
    ToggleMonitor,
    #[serde(rename_all = "camelCase")]
    Seek {
        delta_sec: f64,
    },
    OutputVolume {
        value: f64,
    },
    GuideVolume {
        value: f64,
    },
    MonitorGain {
        value: f64,
    },
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

fn in_range(value: f64, min: f64, max: f64) -> bool {
    value.is_finite() && (min..=max).contains(&value)
}

impl RemoteCommand {
    fn validate(&self) -> Result<(), String> {
        let valid = match self {
            Self::Start { target, mode } => {
                let target_valid = match target {
                    StartTarget::Queue => true,
                    StartTarget::Song { file_hash } => {
                        file_hash.len() == 32 && file_hash.bytes().all(|b| b.is_ascii_hexdigit())
                    }
                };
                let mode_valid = match mode {
                    StartMode::Solo {
                        microphone_id,
                        profile,
                    } => {
                        microphone_id
                            .as_deref()
                            .is_none_or(|id| valid_text(id, 512))
                            && profile.as_deref().is_none_or(|name| valid_text(name, 128))
                    }
                    StartMode::Multiplayer { players } => {
                        (2..=4).contains(&players.len())
                            && players.iter().all(|player| {
                                valid_text(&player.id, 32)
                                    && valid_text(&player.microphone_id, 512)
                                    && player
                                        .profile
                                        .as_deref()
                                        .is_none_or(|name| valid_text(name, 128))
                            })
                    }
                };
                target_valid && mode_valid
            }
            Self::Seek { delta_sec } => in_range(*delta_sec, -MAX_SEEK_SECONDS, MAX_SEEK_SECONDS),
            Self::OutputVolume { value } | Self::GuideVolume { value } => {
                in_range(*value, 0.0, 1.0)
            }
            Self::MonitorGain { value } => in_range(*value, 0.0, 2.0),
            _ => true,
        };
        if valid {
            Ok(())
        } else {
            Err("Invalid command".into())
        }
    }
}

pub(super) fn send(app: &AppHandle, command: &RemoteCommand) -> Result<(), String> {
    command.validate()?;
    app.emit(COMMAND_EVENT, command)
        .map_err(|_| "Cannot reach the TV screen".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Microphone {
    id: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StartSetup {
    profiles: Vec<String>,
    active_profile: Option<String>,
    preferred_microphone: Option<String>,
    solo_microphones: Vec<Microphone>,
    multiplayer_microphones: Vec<Microphone>,
    remembered_players: Option<Vec<PlaybackPlayer>>,
}

fn microphones(combine_channels: bool) -> Vec<Microphone> {
    list_microphones(Some(combine_channels))
        .unwrap_or_default()
        .into_iter()
        .map(|MicrophoneInfo { id, name, .. }| Microphone { label: name, id })
        .collect()
}

/// What the phone needs to offer the same solo/multiplayer choices as the TV.
pub(super) fn start_setup() -> StartSetup {
    let config = AppConfig::load();
    let profiles = ProfileStore::load();
    StartSetup {
        profiles: profiles.profiles,
        active_profile: profiles.active,
        preferred_microphone: config.preferred_mic.clone(),
        solo_microphones: microphones(config.combine_multi_channel.unwrap_or(true)),
        multiplayer_microphones: microphones(
            config.multiplayer_combine_multi_channel.unwrap_or(true),
        ),
        remembered_players: config.multiplayer_players,
    }
}
