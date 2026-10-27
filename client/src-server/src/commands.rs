use app_core::{
    ensure_mp3_stems_ready_payload, load_lyrics_file, save_lyrics_and_realign,
    search_lrclib_for_hash, shift_key_done_payload, shift_tempo_done_payload, AnalysisQueue,
    AppConfig, CacheStats, LibraryMenuItems, LibrarySource, LoadSongsParams,
    PixabayVideoDownloaded, PlaybackSession, ProfileStore, SongTarget, SongsStore,
};
use axum::{
    extract::{Path as AxumPath, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::events::EventBus;
use crate::state::AppState;

/// HTTP error wrapper. JSON body matches what `webInvoke` reads on non-2xx.
pub(crate) struct ApiError(pub StatusCode, pub String);

impl ApiError {
    fn bad_request(msg: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, msg.into())
    }

    fn internal(msg: impl Into<String>) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, msg.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, self.1).into_response()
    }
}

pub(crate) type CmdResult = Result<Value, ApiError>;

/// Generic dispatcher that mirrors Tauri's `generate_handler!` table.
pub(crate) async fn handle_cmd(
    State(state): State<AppState>,
    AxumPath(name): AxumPath<String>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if matches!(
        name.as_str(),
        "get_song_video"
            | "search_song_videos"
            | "download_song_video"
            | "set_song_video_offset"
            | "remove_song_video"
    ) {
        if name != "get_song_video" {
            crate::song_video::authorize(&headers)?;
        }
        return crate::song_video::dispatch(&name, payload).await.map(Json);
    }
    let value = dispatch(state, &name, payload).await?;
    Ok(Json(value))
}

async fn dispatch(state: AppState, name: &str, payload: Value) -> CmdResult {
    let events = state.events.clone();

    match name {
        "list_song_video_hashes" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Args {}
            let _: Args = deserialize(payload)?;
            let hashes = read_library(app_core::list_song_video_hashes)
                .await?
                .map_err(ApiError::bad_request)?;
            serde_json::to_value(hashes).map_err(serde_err)
        }
        // ── Init/window stubs ────────────────────────────────────────────
        "frontend_ready" | "window_immersive" | "minimize_window" => Ok(Value::Null),

        // ── Config ───────────────────────────────────────────────────────
        "load_config" => Ok(serde_json::to_value(AppConfig::load()).map_err(serde_err)?),
        "add_custom_background_url" => {
            #[derive(Deserialize)]
            struct Args {
                name: String,
                url: String,
            }
            let args: Args = deserialize(payload)?;
            let config =
                read_library(move || app_core::add_custom_background_url(args.name, args.url))
                    .await?
                    .map_err(ApiError::bad_request)?;
            serde_json::to_value(config).map_err(serde_err)
        }
        "remove_custom_background" => {
            #[derive(Deserialize)]
            struct Args {
                id: String,
            }
            let args: Args = deserialize(payload)?;
            let config = read_library(move || app_core::remove_custom_background(&args.id))
                .await?
                .map_err(ApiError::bad_request)?;
            serde_json::to_value(config).map_err(serde_err)
        }
        "resolve_custom_background_path" | "load_custom_background_shader" => {
            #[derive(Deserialize)]
            struct Args {
                id: String,
            }
            let args: Args = deserialize(payload)?;
            let shader = name == "load_custom_background_shader";
            let value = read_library(move || {
                if shader {
                    app_core::load_custom_background_shader(&args.id)
                } else {
                    app_core::resolve_custom_background_path(&args.id)
                }
            })
            .await?
            .map_err(ApiError::bad_request)?;
            Ok(Value::String(value))
        }
        "save_config" => save_config_cmd(payload),

        // ── Cache ────────────────────────────────────────────────────────
        "calculate_cache_stats" => {
            let stats = read_library(CacheStats::calculate).await?;
            Ok(serde_json::to_value(stats).map_err(serde_err)?)
        }
        "clear_videos_command" => {
            read_library(app_core::clear_videos).await?;
            Ok(Value::Null)
        }
        "clear_models_command" => {
            read_library(app_core::clear_models).await?;
            Ok(Value::Null)
        }
        "clear_all" => {
            read_library(|| {
                app_core::clear_models();
                app_core::clear_videos();
            })
            .await?;
            Ok(Value::Null)
        }

        // ── Profile ──────────────────────────────────────────────────────
        "load_profiles" => Ok(serde_json::to_value(ProfileStore::load()).map_err(serde_err)?),
        "create_profile" => {
            let args: NameArgs = deserialize(payload)?;
            let mut store = ProfileStore::load();
            store.create_profile(args.name);
            Ok(Value::Null)
        }
        "switch_profile" => {
            let args: NameArgs = deserialize(payload)?;
            let mut store = ProfileStore::load();
            store.switch_profile(&args.name);
            Ok(Value::Null)
        }
        "delete_profile" => {
            let args: NameArgs = deserialize(payload)?;
            let mut store = ProfileStore::load();
            store.delete_profile(&args.name);
            Ok(Value::Null)
        }
        "add_score" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                song_hash: String,
                score: u32,
                profile: Option<String>,
            }
            let args: Args = deserialize(payload)?;
            let mut store = ProfileStore::load();
            store.add_score(&args.song_hash, args.score, args.profile.as_deref());
            Ok(Value::Null)
        }
        "add_scores" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                song_hash: String,
                scores: Vec<(String, u32)>,
            }
            let args: Args = deserialize(payload)?;
            read_library(move || ProfileStore::load().add_scores(&args.song_hash, &args.scores))
                .await?
                .map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }

        // ── Playback queue ───────────────────────────────────────────────
        "load_playback_queue" => {
            let entries = state.playback_queue.entries().map_err(ApiError::internal)?;
            Ok(serde_json::to_value(entries).map_err(serde_err)?)
        }
        "add_playback_queue_entry" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                tempo: f64,
                key_offset: i32,
            }
            let args: Args = deserialize(payload)?;
            let entries = state
                .playback_queue
                .add(&args.file_hash, args.tempo, args.key_offset)
                .map_err(ApiError::bad_request)?;
            events.emit("playback-queue-changed", &entries);
            Ok(serde_json::to_value(entries).map_err(serde_err)?)
        }
        "remove_playback_queue_entry" => {
            #[derive(Deserialize)]
            struct Args {
                id: String,
            }
            let args: Args = deserialize(payload)?;
            let entries = state
                .playback_queue
                .remove(&args.id)
                .map_err(ApiError::internal)?;
            events.emit("playback-queue-changed", &entries);
            Ok(serde_json::to_value(entries).map_err(serde_err)?)
        }
        "move_playback_queue_entry" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                id: String,
                target_index: usize,
            }
            let args: Args = deserialize(payload)?;
            let entries = state
                .playback_queue
                .move_entry(&args.id, args.target_index)
                .map_err(ApiError::bad_request)?;
            events.emit("playback-queue-changed", &entries);
            serde_json::to_value(entries).map_err(serde_err)
        }
        "clear_playback_queue" => {
            let entries = state.playback_queue.clear().map_err(ApiError::internal)?;
            events.emit("playback-queue-changed", &entries);
            Ok(serde_json::to_value(entries).map_err(serde_err)?)
        }

        // ── Playback session ─────────────────────────────────────────────
        "load_playback_session" => {
            let session = state.playback_sessions.load().map_err(ApiError::internal)?;
            Ok(serde_json::to_value(session).map_err(serde_err)?)
        }
        "save_playback_session" => {
            #[derive(Deserialize)]
            struct Args {
                session: PlaybackSession,
            }
            let args: Args = deserialize(payload)?;
            let session = state
                .playback_sessions
                .save(args.session)
                .map_err(ApiError::internal)?;
            events.emit("playback-session-changed", &session);
            Ok(serde_json::to_value(session).map_err(serde_err)?)
        }

        // ── Scanner ──────────────────────────────────────────────────────
        "trigger_scan" => {
            app_core::start_scan();
            Ok(Value::Null)
        }
        "reconcile_cache" => {
            let summary = read_library(app_core::reconcile_cache)
                .await?
                .map_err(ApiError::internal)?;
            serde_json::to_value(summary).map_err(serde_err)
        }
        "set_library_source" => {
            #[derive(Deserialize)]
            struct Args {
                source: LibrarySource,
            }
            let args: Args = deserialize(payload)?;
            let mut config = AppConfig::load();
            config.library_source = Some(args.source);
            config.last_folder = None;
            config.save();
            app_core::start_scan();
            Ok(serde_json::to_value(config).map_err(serde_err)?)
        }
        "clear_library_source" => {
            let mut config = AppConfig::load();
            config.library_source = None;
            config.last_folder = None;
            config.save();
            Ok(serde_json::to_value(config).map_err(serde_err)?)
        }
        "jellyfin_login" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                base_url: String,
                username: String,
                password: String,
            }
            let args: Args = deserialize(payload)?;
            let result =
                app_core::jellyfin_login(&args.base_url, &args.username, &args.password, None)
                    .map_err(|e| ApiError::bad_request(e.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "jellyfin_ping" => {
            Ok(serde_json::to_value(app_core::jellyfin_ping_current()).map_err(serde_err)?)
        }
        "navidrome_login" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                base_url: String,
                username: String,
                password: String,
            }
            let args: Args = deserialize(payload)?;
            let result = app_core::navidrome_login(&args.base_url, &args.username, &args.password)
                .map_err(|e| ApiError::bad_request(e.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "navidrome_ping" => {
            Ok(serde_json::to_value(app_core::navidrome_ping_current()).map_err(serde_err)?)
        }
        "plex_begin_pin" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                #[serde(default)]
                client_id: Option<String>,
            }
            let args: Args = deserialize(payload)?;
            let result =
                tokio::task::spawn_blocking(move || app_core::plex_begin_pin(args.client_id))
                    .await
                    .map_err(blocking_task_err)?
                    .map_err(|error| ApiError::bad_request(error.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "plex_poll_pin" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                pin_id: String,
                client_id: String,
            }
            let args: Args = deserialize(payload)?;
            let result = tokio::task::spawn_blocking(move || {
                app_core::plex_poll_pin(&args.pin_id, &args.client_id)
            })
            .await
            .map_err(blocking_task_err)?
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "plex_manual_login" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                base_url: String,
                access_token: String,
                #[serde(default)]
                client_id: Option<String>,
            }
            let args: Args = deserialize(payload)?;
            let result = tokio::task::spawn_blocking(move || {
                app_core::plex_manual_login(&args.base_url, &args.access_token, args.client_id)
            })
            .await
            .map_err(blocking_task_err)?
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "plex_ping" => {
            let result = tokio::task::spawn_blocking(app_core::plex_ping_current)
                .await
                .map_err(blocking_task_err)?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "load_songs" => {
            #[derive(Deserialize)]
            struct Args {
                params: LoadSongsParams,
            }
            let args: Args = deserialize(payload)?;
            let songs = read_library(move || SongsStore::load(&args.params))
                .await?
                .map_err(|error| {
                    tracing::warn!(%error, "Library search failed");
                    ApiError::internal("Could not load songs. Try again.")
                })?;
            serde_json::to_value(songs).map_err(serde_err)
        }
        "load_songs_by_hashes" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hashes: Vec<String>,
            }
            let args: Args = deserialize(payload)?;
            let songs = read_library(move || SongsStore::load_by_hashes(&args.file_hashes)).await?;
            serde_json::to_value(songs).map_err(serde_err)
        }
        "load_songs_meta" => {
            let meta = read_library(SongsStore::load_meta).await?;
            serde_json::to_value(meta).map_err(serde_err)
        }
        "load_favorite_hashes" => {
            let hashes = read_library(app_core::load_favorite_hashes)
                .await?
                .map_err(ApiError::internal)?;
            Ok(serde_json::to_value(hashes).map_err(serde_err)?)
        }
        "set_song_favorite" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                favorite: bool,
            }
            let args: Args = deserialize(payload)?;
            tokio::task::spawn_blocking(move || {
                app_core::set_song_favorite(&args.file_hash, args.favorite)
            })
            .await
            .map_err(blocking_task_err)?
            .map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "load_analysis_queue" => {
            let queue = read_library(AnalysisQueue::load).await?.map_err(|error| {
                tracing::warn!(%error, "Could not load analysis queue");
                ApiError::internal("Could not load analysis queue. Try again.")
            })?;
            serde_json::to_value(queue).map_err(serde_err)
        }
        "load_library_menu_items" => {
            let items: LibraryMenuItems = read_library(app_core::load_library_menu_items)
                .await?
                .map_err(|e| ApiError::internal(e.to_string()))?;
            Ok(serde_json::to_value(items).map_err(serde_err)?)
        }

        // ── Analyzer ─────────────────────────────────────────────────────
        "enqueue" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                tokio::task::spawn_blocking(move || app_core::enqueue(args.target))
                    .await
                    .map_err(blocking_task_err)?
                    .map_err(ApiError::internal)?,
            ))
        }
        "cancel_analysis" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                tokio::task::spawn_blocking(move || app_core::cancel_analysis(args.target))
                    .await
                    .map_err(blocking_task_err)?
                    .map_err(ApiError::internal)?,
            ))
        }
        "delete_song_cache" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                tokio::task::spawn_blocking(move || app_core::delete_cache(args.target))
                    .await
                    .map_err(blocking_task_err)?
                    .map_err(ApiError::internal)?,
            ))
        }
        "reanalyze_transcript" => {
            let args: SongTargetLanguageArgs = deserialize(payload)?;
            Ok(Value::from(
                tokio::task::spawn_blocking(move || {
                    app_core::reanalyze_transcript(args.target, args.language)
                })
                .await
                .map_err(blocking_task_err)?
                .map_err(ApiError::internal)?,
            ))
        }
        "reanalyze_full" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                tokio::task::spawn_blocking(move || app_core::reanalyze_full(args.target))
                    .await
                    .map_err(blocking_task_err)?
                    .map_err(ApiError::internal)?,
            ))
        }
        "realign" => {
            let args: SongTargetLanguageArgs = deserialize(payload)?;
            Ok(Value::from(
                tokio::task::spawn_blocking(move || app_core::realign(args.target, args.language))
                    .await
                    .map_err(blocking_task_err)?
                    .map_err(ApiError::internal)?,
            ))
        }
        "reanalyze_force_transcribe" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                app_core::reanalyze_force_transcribe(args.target).map_err(ApiError::internal)?,
            ))
        }
        "refresh_metadata" => {
            let args: SongTargetArgs = deserialize(payload)?;
            let count =
                tokio::task::spawn_blocking(move || app_core::refresh_metadata(args.target))
                    .await
                    .map_err(|e| ApiError::internal(e.to_string()))?
                    .map_err(ApiError::internal)?;
            Ok(Value::from(count))
        }
        "shift_key" => shift_key_cmd(events, payload),
        "shift_tempo" => shift_tempo_cmd(events, payload),

        // ── Lyrics ───────────────────────────────────────────────────────
        "load_lyrics" => {
            let args: FileHashArgs = deserialize(payload)?;
            Ok(serde_json::to_value(load_lyrics_file(&args.file_hash)).map_err(serde_err)?)
        }
        "load_sidecar_lrc" => {
            let args: FileHashArgs = deserialize(payload)?;
            let lyrics = read_library(move || app_core::load_sidecar_lrc(&args.file_hash)).await?;
            serde_json::to_value(lyrics).map_err(serde_err)
        }
        "align_lrc_lyrics" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                lrc_text: String,
            }
            let args: Args = deserialize(payload)?;
            read_library(move || app_core::align_lrc_lyrics(&args.file_hash, &args.lrc_text))
                .await?
                .map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "search_lrclib_lyrics" => {
            let args: FileHashArgs = deserialize(payload)?;
            Ok(serde_json::to_value(search_lrclib_for_hash(&args.file_hash)).map_err(serde_err)?)
        }
        "save_lyrics" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                lines: Vec<String>,
            }
            let args: Args = deserialize(payload)?;
            save_lyrics_and_realign(&args.file_hash, args.lines).map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "provide_lrc" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                lrc_text: String,
                separate_stems: bool,
            }
            let args: Args = deserialize(payload)?;
            app_core::provide_lrc(&args.file_hash, &args.lrc_text, args.separate_stems)
                .map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "apply_timed_lyrics" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                lrc_text: String,
            }
            let args: Args = deserialize(payload)?;
            app_core::apply_timed_lyrics(&args.file_hash, &args.lrc_text)
                .map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }

        // ── Playback ─────────────────────────────────────────────────────
        "load_transcript" => {
            let args: FileHashArgs = deserialize(payload)?;
            app_core::load_transcript(&args.file_hash)
                .map_err(|e| ApiError::internal(e.to_string()))
        }
        "get_audio_paths" => {
            let args: FileHashArgs = deserialize(payload)?;
            Ok(
                serde_json::to_value(app_core::get_audio_paths(&args.file_hash))
                    .map_err(serde_err)?,
            )
        }
        "ensure_mp3_stems" => ensure_mp3_stems_cmd(events, payload),
        "ensure_playable_source_video" => {
            let args: FileHashArgs = deserialize(payload)?;
            let path = tokio::task::spawn_blocking(move || {
                app_core::ensure_playable_source_video(&args.file_hash)
                    .ok()
                    .flatten()
            })
            .await
            .map_err(blocking_task_err)?;
            Ok(serde_json::to_value(path).map_err(serde_err)?)
        }
        "fetch_pixabay_videos" => fetch_pixabay_videos_cmd(events, payload),

        // ── Vendor ───────────────────────────────────────────────────────
        "is_ready" => Ok(Value::Bool(app_core::is_ready())),
        "trigger_setup" => vendor::trigger_setup(events, payload),

        // ── Mic (browser-side; no server-side state) ────────────────────
        "list_microphones" => Ok(Value::Array(vec![])),
        "start_mic_capture" | "stop_mic_capture" => Ok(Value::Null),

        _ => Err(ApiError(
            StatusCode::NOT_FOUND,
            format!("unknown command {name}"),
        )),
    }
}

async fn read_library<T, F>(operation: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(blocking_task_err)
}

fn serde_err(e: serde_json::Error) -> ApiError {
    ApiError::internal(format!("serialise: {e}"))
}

fn blocking_task_err(error: tokio::task::JoinError) -> ApiError {
    ApiError::internal(format!("blocking command failed: {error}"))
}

fn deserialize<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, ApiError> {
    serde_json::from_value(value).map_err(|e| ApiError::bad_request(format!("invalid args: {e}")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NameArgs {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileHashArgs {
    file_hash: String,
}

#[derive(Deserialize)]
struct SongTargetArgs {
    target: SongTarget,
}

#[derive(Deserialize)]
struct SongTargetLanguageArgs {
    target: SongTarget,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Deserialize)]
struct SaveConfigArgs {
    config: AppConfig,
}

fn save_config_cmd(payload: Value) -> CmdResult {
    let SaveConfigArgs { mut config } = deserialize(payload)?;
    let current = AppConfig::load();
    let was_auto_analyze = current.auto_analyze();
    config.desktop_window = current.desktop_window;
    config.playback_window = current.playback_window;
    config.save();
    if config.auto_analyze() && !was_auto_analyze {
        let _ = app_core::enqueue(SongTarget::Filter {
            filters: app_core::LibraryMenuFilters::default(),
        });
    }
    // Web mode has no server-side cpal monitor stream, so `mic_monitor_gain`
    // is consumed entirely by the browser's monitor GainNode.
    serde_json::to_value(config).map_err(serde_err)
}

fn shift_key_cmd(events: std::sync::Arc<EventBus>, payload: Value) -> CmdResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        file_hash: String,
        key: String,
        pitch_ratio: f64,
        key_offset: i32,
    }
    let args: Args = deserialize(payload)?;
    std::thread::spawn(move || {
        let payload =
            shift_key_done_payload(args.file_hash, args.key, args.pitch_ratio, args.key_offset);
        events.emit("shift-key-done", &payload);
    });
    Ok(Value::Null)
}

fn shift_tempo_cmd(events: std::sync::Arc<EventBus>, payload: Value) -> CmdResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        file_hash: String,
        tempo: f64,
    }
    let args: Args = deserialize(payload)?;
    std::thread::spawn(move || {
        let payload = shift_tempo_done_payload(args.file_hash, args.tempo);
        events.emit("shift-tempo-done", &payload);
    });
    Ok(Value::Null)
}

fn ensure_mp3_stems_cmd(events: std::sync::Arc<EventBus>, payload: Value) -> CmdResult {
    let args: FileHashArgs = deserialize(payload)?;
    std::thread::spawn(move || {
        events.emit(
            "stems-ready",
            &ensure_mp3_stems_ready_payload(args.file_hash),
        );
    });
    Ok(Value::Null)
}

fn fetch_pixabay_videos_cmd(events: std::sync::Arc<EventBus>, payload: Value) -> CmdResult {
    #[derive(Deserialize)]
    struct Args {
        flavor: String,
    }
    let args: Args = deserialize(payload)?;
    let cached = app_core::get_cached_pixabay_videos(&args.flavor);

    let flavor_for_thread = args.flavor.clone();
    let events_clone = events.clone();
    std::thread::spawn(move || {
        let flavor_for_emit = flavor_for_thread.clone();
        app_core::download_pixabay_videos(&flavor_for_thread, move |path, evicted_path| {
            events_clone.emit(
                "pixabay-video-downloaded",
                &PixabayVideoDownloaded::new(flavor_for_emit.clone(), path, evicted_path),
            );
        });
    });

    Ok(json!(cached))
}

pub(crate) mod vendor;
