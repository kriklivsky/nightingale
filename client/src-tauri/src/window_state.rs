use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use app_core::{AppConfig, WindowState};
use tauri::{AppHandle, Manager, PhysicalSize, WebviewWindow, WindowEvent};

#[derive(Default)]
pub(crate) struct WindowStates(Arc<Mutex<HashMap<String, TrackedWindowState>>>);

struct TrackedWindowState {
    state: WindowState,
    latest_size: Option<PhysicalSize<u32>>,
}

fn saved(config: &AppConfig, label: &str) -> Result<WindowState, String> {
    match label {
        "main" => Ok(config.desktop_window.clone()),
        "playback" => Ok(config.playback_window.clone()),
        _ => Err("Unsupported window label".into()),
    }
}

fn save(config: &mut AppConfig, label: &str, state: WindowState) {
    match label {
        "main" => config.desktop_window = state,
        "playback" => config.playback_window = state,
        _ => (),
    }
}

fn snapshot(states: &WindowStates, window: &WebviewWindow) -> Option<WindowState> {
    let mut states = states.0.lock().ok()?;
    let tracked = states.get_mut(window.label())?;
    tracked.state.maximized = window.is_maximized().ok()?;
    if !tracked.state.maximized && !window.is_fullscreen().ok()? {
        if let Some(size) = tracked.latest_size {
            tracked.state.width = Some(size.width);
            tracked.state.height = Some(size.height);
        }
    }
    Some(tracked.state.clone())
}

pub(crate) fn register(window: &WebviewWindow, state: WindowState) {
    let label = window.label().to_string();
    let states = Arc::clone(&window.state::<WindowStates>().0);
    states
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(
            label.clone(),
            TrackedWindowState {
                state,
                latest_size: None,
            },
        );
    let app = window.app_handle().clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(size) => {
            if let Some(tracked) = states
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .get_mut(&label)
            {
                tracked.latest_size = Some(*size);
            }
        }
        WindowEvent::CloseRequested { .. } => save_open(&app),
        WindowEvent::Destroyed if label == "main" => app.exit(0),
        _ => {}
    });
}

pub(crate) fn configure(
    window: &WebviewWindow,
    config: &AppConfig,
    tvbox_session: bool,
) -> Result<(), String> {
    let state = saved(config, window.label())?;
    if !tvbox_session && config.fullscreen != Some(true) {
        if let (Some(width), Some(height)) = (state.width, state.height) {
            window
                .set_size(PhysicalSize::new(width, height))
                .map_err(|error| error.to_string())?;
        }
        if state.maximized {
            window.maximize().map_err(|error| error.to_string())?;
        }
    }
    register(window, state);
    Ok(())
}

pub(crate) fn save_open(app: &AppHandle) {
    let mut config = AppConfig::load();
    for (label, window) in app.webview_windows() {
        if let Some(state) = snapshot(&app.state::<WindowStates>(), &window) {
            save(&mut config, &label, state);
        }
    }
    config.save();
}

#[tauri::command]
pub(crate) fn load_window_state(label: String) -> Result<WindowState, String> {
    saved(&AppConfig::load(), &label)
}

#[tauri::command]
pub(crate) fn track_window_state(app: AppHandle, label: String) -> Result<(), String> {
    let state = saved(&AppConfig::load(), &label)?;
    let window = app.get_webview_window(&label).ok_or("Window not found")?;
    register(&window, state);
    Ok(())
}
