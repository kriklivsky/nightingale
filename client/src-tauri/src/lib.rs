mod analyzer;
mod backgrounds;
mod cache;
mod config;
mod keyboard;
mod logging;
mod lyrics;
mod microphones;
mod playback;
mod playback_queue;
mod playback_session;
mod profile;
mod scanner;
mod song_video;
mod vendor;
mod window_state;

use analyzer::{
    cancel_analysis, delete_song_cache, enqueue, realign, reanalyze_force_transcribe,
    reanalyze_full, reanalyze_transcript, refresh_metadata, shift_key, shift_tempo,
};
use app_core::{AppConfig, LibrarySource, PlaybackQueue, PlaybackSessionStore, SongsStore};
use backgrounds::{
    add_custom_background_url, import_custom_background, load_custom_background_shader,
    remove_custom_background, resolve_custom_background_path,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use cache::{calculate_cache_stats, clear_all, clear_models_command, clear_videos_command};
use config::{load_config, save_config};
use keyboard::hardware_keyboard_available;
use lyrics::{
    align_lrc_lyrics, apply_timed_lyrics, load_lyrics, load_sidecar_lrc, provide_lrc, save_lyrics,
    search_lrclib_lyrics,
};
use microphones::{
    list_microphones, set_monitor_gain, start_configured_monitor, start_mic_capture,
    stop_mic_capture, update_mic_capture_options,
};
use playback::{
    ensure_mp3_stems, ensure_playable_source_video, fetch_pixabay_videos, get_audio_paths,
    load_transcript,
};
use playback_queue::{
    add_playback_queue_entry, clear_playback_queue, load_playback_queue, move_playback_queue_entry,
    remove_playback_queue_entry,
};
use playback_session::{load_playback_session, save_playback_session};
use profile::{
    add_score, add_scores, create_profile, delete_profile, load_profiles, switch_profile,
};
use scanner::{
    clear_library_source, delete_local_song, jellyfin_login, jellyfin_ping, load_analysis_queue,
    load_favorite_hashes, load_library_menu_items, load_songs, load_songs_by_hashes,
    load_songs_meta, navidrome_login, navidrome_ping, plex_begin_pin, plex_manual_login, plex_ping,
    plex_poll_pin, reconcile_cache, set_library_source, set_song_favorite, trigger_scan,
};
use song_video::{
    download_song_video, get_song_video, list_song_video_hashes, remove_song_video,
    search_song_videos, set_song_video_offset,
};
use tauri::{Manager, RunEvent, WebviewWindowBuilder};
use vendor::{is_ready, trigger_setup};
use window_state::{load_window_state, track_window_state};

#[tauri::command]
fn get_media_endpoint() -> app_core::MediaEndpoint {
    app_core::media_server::endpoint()
}

#[tauri::command]
fn frontend_ready(window: tauri::Window) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())
}

/// True for native fullscreen or a borderless window that already fills its monitor.
/// The size fallback also covers lightweight TV sessions without an EWMH window manager,
/// where the compositor cannot acknowledge the usual fullscreen state request.
#[tauri::command]
fn window_immersive(window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.is_fullscreen().map_err(|e| e.to_string())? {
        return Ok(true);
    }

    let inner = window.inner_size().map_err(|e| e.to_string())?;
    if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
        let monitor_size = monitor.size();
        let width_delta = (inner.width as i32 - monitor_size.width as i32).abs();
        let height_delta = (inner.height as i32 - monitor_size.height as i32).abs();
        if width_delta <= 2 && height_delta <= 2 {
            return Ok(true);
        }
    }

    Ok(false)
}

/// macOS simple fullscreen clears `Miniaturizable`; exit that mode before minimizing.
#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_simple_fullscreen(false);
    }
    window.minimize().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("TVBOX_STATUS").is_some() {
        std::env::set_var("GIO_USE_NETWORK_MONITOR", "netlink");
        if std::env::var_os("GST_PLUGIN_FEATURE_RANK").is_none() {
            std::env::set_var("GST_PLUGIN_FEATURE_RANK", "mppvideodec:768,openh264dec:512");
        }
    }

    logging::init();

    tauri::Builder::default()
        .manage(window_state::WindowStates::default())
        .manage(PlaybackQueue::default())
        .manage(PlaybackSessionStore::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            // Init
            frontend_ready,
            hardware_keyboard_available,
            window_immersive,
            minimize_window,
            load_window_state,
            track_window_state,
            // Config
            load_config,
            save_config,
            add_custom_background_url,
            import_custom_background,
            load_custom_background_shader,
            remove_custom_background,
            resolve_custom_background_path,
            // Cache
            calculate_cache_stats,
            clear_videos_command,
            clear_models_command,
            clear_all,
            // Profile
            load_profiles,
            switch_profile,
            create_profile,
            delete_profile,
            add_score,
            add_scores,
            // Playback queue
            load_playback_queue,
            add_playback_queue_entry,
            remove_playback_queue_entry,
            move_playback_queue_entry,
            clear_playback_queue,
            // Playback session
            load_playback_session,
            save_playback_session,
            // Scanner
            trigger_scan,
            reconcile_cache,
            set_library_source,
            clear_library_source,
            jellyfin_login,
            jellyfin_ping,
            navidrome_login,
            navidrome_ping,
            plex_begin_pin,
            plex_poll_pin,
            plex_manual_login,
            plex_ping,
            load_songs,
            load_songs_by_hashes,
            load_songs_meta,
            load_favorite_hashes,
            set_song_favorite,
            delete_local_song,
            load_analysis_queue,
            load_library_menu_items,
            // Analyzer
            enqueue,
            cancel_analysis,
            delete_song_cache,
            reanalyze_transcript,
            reanalyze_full,
            realign,
            reanalyze_force_transcribe,
            refresh_metadata,
            shift_key,
            shift_tempo,
            // Lyrics
            load_lyrics,
            load_sidecar_lrc,
            align_lrc_lyrics,
            search_lrclib_lyrics,
            save_lyrics,
            provide_lrc,
            apply_timed_lyrics,
            // Playback
            load_transcript,
            get_audio_paths,
            ensure_mp3_stems,
            ensure_playable_source_video,
            fetch_pixabay_videos,
            get_media_endpoint,
            get_song_video,
            list_song_video_hashes,
            search_song_videos,
            download_song_video,
            set_song_video_offset,
            remove_song_video,
            list_microphones,
            start_mic_capture,
            stop_mic_capture,
            update_mic_capture_options,
            // Vendor
            is_ready,
            trigger_setup
        ])
        .setup(|app| {
            let _ = dotenvy::dotenv();
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            app_core::startup()?;
            app_core::media_server::start()?;
            let media_endpoint = app_core::media_server::endpoint();

            let config = AppConfig::load();
            set_monitor_gain(config.mic_monitor_gain());
            start_configured_monitor(&config);
            if matches!(
                config.library_source.as_ref(),
                Some(LibrarySource::Folder { .. })
            ) {
                app_core::start_scan();
            }
            app.handle()
                .asset_protocol_scope()
                .allow_directory(config.effective_data_path(), true)
                .map_err(|e| format!("failed to allow asset protocol for data path: {e}"))?;
            app.handle()
                .asset_protocol_scope()
                .allow_directory(app_core::default_nightingale_dir(), true)
                .map_err(|e| format!("failed to allow asset protocol for default path: {e}"))?;
            for root in app_core::cache_roots() {
                app.handle()
                    .asset_protocol_scope()
                    .allow_directory(root, true)
                    .map_err(|e| format!("failed to allow asset protocol for cache path: {e}"))?;
            }
            let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
            let b64 = B64.encode(json.as_bytes());

            let songs_meta = SongsStore::load_meta();
            let meta_json = serde_json::to_string(&songs_meta).map_err(|e| e.to_string())?;
            let meta_b64 = B64.encode(meta_json.as_bytes());

            let endpoint_json =
                serde_json::to_string(&media_endpoint).map_err(|e| e.to_string())?;
            let endpoint_b64 = B64.encode(endpoint_json.as_bytes());

            let tvbox_session = std::env::var_os("TVBOX_STATUS").is_some();
            let init_script = format!(
                "window.__NIGHTINGALE_APP_CONFIG__ = JSON.parse(atob('{b64}')); \
                 window.__NIGHTINGALE_SONGS_META__ = JSON.parse(atob('{meta_b64}')); \
                 window.__NIGHTINGALE_MEDIA_ENDPOINT__ = JSON.parse(atob('{endpoint_b64}')); \
                 document.addEventListener('DOMContentLoaded', () => {{ \
                   if ({tvbox_session}) document.documentElement.classList.add('tvbox-session'); \
                 }});",
            );

            let window_config = app
                .config()
                .app
                .windows
                .first()
                .ok_or_else(|| "tauri.conf.json must define at least one window".to_string())?;

            let window = WebviewWindowBuilder::from_config(app.handle(), window_config)
                .map_err(|e| e.to_string())?
                .initialization_script(init_script)
                .build()
                .map_err(|e| e.to_string())?;

            window_state::configure(&window, &config, tvbox_session)?;

            if tvbox_session {
                if let Err(error) = window.set_cursor_visible(false) {
                    tracing::warn!("Failed to hide TV cursor: {error}");
                }
            }

            if config.fullscreen == Some(true) {
                #[cfg(target_os = "macos")]
                let _ = window.set_simple_fullscreen(true);
                #[cfg(not(target_os = "macos"))]
                let _ = window.set_fullscreen(true);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                window_state::save_open(app);
                app_core::shutdown_server();
            }
        });
}
