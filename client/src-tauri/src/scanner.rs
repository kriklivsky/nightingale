use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

use app_core::{
    AnalysisQueue, AppConfig, JellyfinHealth, JellyfinLoginResult, LibraryMenuItems, LibrarySource,
    LoadSongsParams, NavidromeHealth, NavidromeLoginResult, PlaybackQueue, PlexHealth,
    PlexPinPollResult, PlexPinStart, PlexServer, Song, SongsMeta, SongsStore,
};

#[tauri::command]
pub(crate) fn trigger_scan() {
    app_core::start_scan();
}

#[tauri::command]
pub(crate) async fn reconcile_cache() -> Result<app_core::CacheReconcileSummary, String> {
    tauri::async_runtime::spawn_blocking(app_core::reconcile_cache)
        .await
        .map_err(|error| format!("Cache reconciliation task failed: {error}"))?
}

#[tauri::command]
pub(crate) fn set_library_source(source: LibrarySource) -> AppConfig {
    let mut config = AppConfig::load();
    config.library_source = Some(source);
    config.last_folder = None;
    config.save();
    app_core::start_scan();
    config
}

#[tauri::command]
pub(crate) fn clear_library_source() -> AppConfig {
    let mut config = AppConfig::load();
    config.library_source = None;
    config.last_folder = None;
    config.save();
    config
}

#[tauri::command]
pub(crate) fn jellyfin_login(
    base_url: String,
    username: String,
    password: String,
) -> Result<JellyfinLoginResult, String> {
    app_core::jellyfin_login(&base_url, &username, &password, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn jellyfin_ping() -> JellyfinHealth {
    app_core::jellyfin_ping_current()
}

#[tauri::command]
pub(crate) fn navidrome_login(
    base_url: String,
    username: String,
    password: String,
) -> Result<NavidromeLoginResult, String> {
    app_core::navidrome_login(&base_url, &username, &password).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn navidrome_ping() -> NavidromeHealth {
    app_core::navidrome_ping_current()
}

#[tauri::command]
pub(crate) fn plex_begin_pin(client_id: Option<String>) -> Result<PlexPinStart, String> {
    app_core::plex_begin_pin(client_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn plex_poll_pin(
    pin_id: String,
    client_id: String,
) -> Result<PlexPinPollResult, String> {
    app_core::plex_poll_pin(&pin_id, &client_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn plex_manual_login(
    base_url: String,
    access_token: String,
    client_id: Option<String>,
) -> Result<PlexServer, String> {
    app_core::plex_manual_login(&base_url, &access_token, client_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn plex_ping() -> PlexHealth {
    app_core::plex_ping_current()
}

#[tauri::command]
pub(crate) async fn load_songs(params: LoadSongsParams) -> Result<SongsStore, String> {
    read_library(move || SongsStore::load(&params))
        .await?
        .map_err(|error| {
            tracing::warn!(%error, "Library search failed");
            "Could not load songs. Try again.".to_string()
        })
}

#[tauri::command]
pub(crate) async fn load_songs_by_hashes(file_hashes: Vec<String>) -> Result<Vec<Song>, String> {
    read_library(move || SongsStore::load_by_hashes(&file_hashes)).await
}

#[tauri::command]
pub(crate) async fn load_songs_meta() -> Result<SongsMeta, String> {
    read_library(SongsStore::load_meta).await
}

#[tauri::command]
pub(crate) async fn load_favorite_hashes() -> Result<Vec<String>, String> {
    read_library(app_core::load_favorite_hashes).await?
}

#[tauri::command]
pub(crate) fn set_song_favorite(file_hash: String, favorite: bool) -> Result<(), String> {
    app_core::set_song_favorite(&file_hash, favorite)
}

#[tauri::command]
pub(crate) fn delete_local_song(
    app: AppHandle,
    queue: State<'_, PlaybackQueue>,
    file_hash: String,
    path: PathBuf,
) -> Result<(), String> {
    app_core::delete_local_song(&file_hash, &path)?;
    if let Ok(entries) = queue.remove_song_path(&path) {
        let _ = app.emit("playback-queue-changed", entries);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn load_analysis_queue() -> Result<AnalysisQueue, String> {
    read_library(AnalysisQueue::load).await?.map_err(|error| {
        tracing::warn!(%error, "Could not load analysis queue");
        "Could not load analysis queue. Try again.".to_string()
    })
}

#[tauri::command]
pub(crate) async fn load_library_menu_items() -> Result<LibraryMenuItems, String> {
    read_library(app_core::load_library_menu_items)
        .await?
        .map_err(|error| error.to_string())
}

async fn read_library<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| "Library request interrupted. Try again.".to_string())
}
