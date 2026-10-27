use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use app_core::AppConfig;
use cpal::traits::DeviceTrait;
use tauri::ipc::Channel;
use tracing::warn;

use super::buffering::{Direction, MonitorBuffers};
use super::{find_device, run_mic_loop, MicCaptureOptions, MicSampleFrame};

const CONFIGURED_MONITOR: &str = "nightingale-configured-monitor";
const MAX_CAPTURES: usize = 8;

pub(super) struct AudioState {
    pub(super) shutdown: AtomicBool,
    pub(super) running: AtomicBool,
    pub(super) input_channels: AtomicUsize,
    pub(super) failures: AtomicUsize,
    pub(super) monitor_channels: AtomicU64,
    pub(super) buffers: Mutex<MonitorBuffers>,
}

impl AudioState {
    pub(super) fn report_error(&self, error: cpal::StreamError, direction: Direction) {
        if self.failures.fetch_or(direction.mask(), Ordering::Relaxed) & direction.mask() == 0 {
            warn!(
                "[mic] {} stream failed; reopening audio devices: {error}",
                direction.label()
            );
        }
    }
}

pub(super) struct CaptureTarget {
    pub(super) selected_channel: Option<usize>,
    pub(super) emit_audio: bool,
    pub(super) channel: Option<Channel<MicSampleFrame>>,
}

pub(super) type CaptureTargets = Arc<Mutex<HashMap<String, CaptureTarget>>>;

struct Capture {
    state: Arc<AudioState>,
    targets: CaptureTargets,
    thread: JoinHandle<()>,
}

static CAPTURES: once_cell::sync::Lazy<Mutex<HashMap<String, Capture>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));
static OPERATIONS: Mutex<()> = Mutex::new(());
static WATCHDOG: std::sync::Once = std::sync::Once::new();

pub(super) fn active_input_channels(device_id: &str) -> Option<usize> {
    CAPTURES
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(device_id)
        .filter(|capture| capture.state.running.load(Ordering::Acquire))
        .map(|capture| capture.state.input_channels.load(Ordering::Relaxed))
}

fn validate_channel(channel: Option<usize>, channels: usize) -> Result<(), String> {
    if channels == 0 || channels > 64 || channel.is_some_and(|channel| channel >= channels) {
        return Err("Requested microphone channel is unavailable".into());
    }
    Ok(())
}

fn update_monitor(capture: &Capture, targets: &HashMap<String, CaptureTarget>) {
    let channels = targets
        .values()
        .filter(|target| target.emit_audio)
        .fold(0, |mask, target| {
            mask | target
                .selected_channel
                .map_or(u64::MAX, |channel| 1 << channel)
        });
    capture
        .state
        .monitor_channels
        .store(channels, Ordering::Relaxed);
}

fn remove_target(id: &str, keep_device: Option<&str>) {
    let removed = {
        let mut captures = CAPTURES.lock().unwrap_or_else(|error| error.into_inner());
        let mut empty = Vec::new();
        for (device_id, capture) in captures.iter() {
            let mut targets = capture
                .targets
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            targets.remove(id);
            update_monitor(capture, &targets);
            if targets.is_empty() && Some(device_id.as_str()) != keep_device {
                empty.push(device_id.clone());
            }
        }
        empty
            .into_iter()
            .filter_map(|device_id| captures.remove(&device_id))
            .collect::<Vec<_>>()
    };
    for capture in removed {
        capture.state.shutdown.store(true, Ordering::Relaxed);
        if capture.thread.join().is_err() {
            warn!("[mic] capture worker terminated unexpectedly");
        }
    }
}

fn frontend_active() -> bool {
    CAPTURES
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .values()
        .any(|capture| {
            capture
                .targets
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .keys()
                .any(|id| id != CONFIGURED_MONITOR)
        })
}

fn start_target(
    id: String,
    preferred: Option<&str>,
    target: CaptureTarget,
) -> Result<String, String> {
    let resolved = find_device(preferred)?;
    let mut captures = CAPTURES.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(capture) = captures.get(&resolved.id) {
        if capture.state.running.load(Ordering::Acquire) {
            validate_channel(
                target.selected_channel,
                capture.state.input_channels.load(Ordering::Relaxed),
            )?;
            let mut targets = capture
                .targets
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if targets.len() >= MAX_CAPTURES {
                return Err("Too many active microphone captures".into());
            }
            targets.insert(id, target);
            update_monitor(capture, &targets);
            return Ok(resolved.name);
        }
    }
    if let Some(stale) = captures.remove(&resolved.id) {
        stale.state.shutdown.store(true, Ordering::Relaxed);
        stale
            .thread
            .join()
            .map_err(|_| "microphone worker failed to stop")?;
    }
    let channels = usize::from(
        resolved
            .device
            .default_input_config()
            .map_err(|error| format!("Input configuration unavailable: {error}"))?
            .channels(),
    );
    validate_channel(target.selected_channel, channels)?;
    let monitor_channels = if target.emit_audio {
        target
            .selected_channel
            .map_or(u64::MAX, |channel| 1 << channel)
    } else {
        0
    };
    let state = Arc::new(AudioState {
        shutdown: AtomicBool::new(false),
        running: AtomicBool::new(false),
        input_channels: AtomicUsize::new(channels),
        failures: AtomicUsize::new(0),
        monitor_channels: AtomicU64::new(monitor_channels),
        buffers: Mutex::new(MonitorBuffers::default()),
    });
    let targets = Arc::new(Mutex::new(HashMap::from([(id, target)])));
    let worker_state = Arc::clone(&state);
    let worker_targets = Arc::clone(&targets);
    let name = resolved.name.clone();
    let (started, startup) = mpsc::sync_channel(1);
    let thread = std::thread::spawn(move || {
        let mut startup = Some(started);
        while !worker_state.shutdown.load(Ordering::Relaxed) {
            worker_state.failures.store(0, Ordering::Relaxed);
            if let Err(error) = run_mic_loop(
                &resolved.device,
                &name,
                &worker_state,
                &worker_targets,
                &mut startup,
            ) {
                if let Some(started) = startup.take() {
                    let _ = started.send(Err(error));
                } else {
                    warn!("[mic] capture stopped: {error}");
                }
                break;
            }
            if worker_state.shutdown.load(Ordering::Relaxed) {
                break;
            }
            let failures = worker_state.failures.load(Ordering::Relaxed);
            if failures != 0 {
                worker_state
                    .buffers
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .failed(failures);
                for _ in 0..25 {
                    if worker_state.shutdown.load(Ordering::Relaxed) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
        worker_state.running.store(false, Ordering::Release);
    });
    let result = startup
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Microphone startup timed out".to_string())
        .and_then(|result| result);
    if let Err(error) = result {
        state.shutdown.store(true, Ordering::Relaxed);
        if thread.join().is_err() {
            warn!("[mic] failed capture worker terminated unexpectedly");
        }
        return Err(error);
    }
    captures.insert(
        resolved.id,
        Capture {
            state,
            targets,
            thread,
        },
    );
    Ok(resolved.name)
}

#[tauri::command]
pub(crate) fn start_mic_capture(
    capture_id: String,
    preferred: Option<String>,
    options: Option<MicCaptureOptions>,
    on_samples: Channel<MicSampleFrame>,
) -> Result<String, String> {
    let _guard = OPERATIONS.lock().unwrap_or_else(|error| error.into_inner());
    if capture_id.is_empty() || capture_id.len() > 128 || capture_id == CONFIGURED_MONITOR {
        return Err("Invalid microphone capture ID".into());
    }
    let resolved = find_device(preferred.as_deref())?;
    remove_target(&capture_id, Some(&resolved.id));
    remove_target(CONFIGURED_MONITOR, Some(&resolved.id));
    let result = start_target(
        capture_id,
        preferred.as_deref(),
        CaptureTarget {
            selected_channel: resolved.selected_channel,
            emit_audio: options.unwrap_or_default().emit_audio,
            channel: Some(on_samples),
        },
    );
    if result.is_err() && !frontend_active() {
        restore_monitor(&AppConfig::load());
    }
    result
}

#[tauri::command]
pub(crate) fn update_mic_capture_options(
    capture_id: String,
    options: MicCaptureOptions,
) -> Result<(), String> {
    let _guard = OPERATIONS.lock().unwrap_or_else(|error| error.into_inner());
    if capture_id.is_empty() || capture_id.len() > 128 || capture_id == CONFIGURED_MONITOR {
        return Err("Invalid microphone capture ID".into());
    }
    let captures = CAPTURES.lock().unwrap_or_else(|error| error.into_inner());
    for capture in captures.values() {
        let mut targets = capture
            .targets
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(target) = targets.get_mut(&capture_id) {
            target.emit_audio = options.emit_audio;
            update_monitor(capture, &targets);
            return Ok(());
        }
    }
    Err("Microphone capture is not active".into())
}

fn restore_monitor(config: &AppConfig) {
    if config.mic_monitoring != Some(true) {
        return;
    }
    if let Err(error) = start_target(
        CONFIGURED_MONITOR.into(),
        config.preferred_mic.as_deref(),
        CaptureTarget {
            selected_channel: None,
            emit_audio: true,
            channel: None,
        },
    ) {
        warn!("[mic] configured monitor unavailable: {error}");
    }
}

pub(crate) fn update_configured_monitor(config: &AppConfig) {
    let _guard = OPERATIONS.lock().unwrap_or_else(|error| error.into_inner());
    if !frontend_active() {
        remove_target(CONFIGURED_MONITOR, None);
        restore_monitor(config);
    }
}

pub(crate) fn start_configured_monitor(config: &AppConfig) {
    update_configured_monitor(config);
    WATCHDOG.call_once(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(5));
            let _guard = OPERATIONS.lock().unwrap_or_else(|error| error.into_inner());
            let running = CAPTURES
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .values()
                .any(|capture| capture.state.running.load(Ordering::Acquire));
            if !running && !frontend_active() {
                let config = AppConfig::load();
                if config.mic_monitoring == Some(true) {
                    restore_monitor(&config);
                }
            }
        });
    });
}

#[tauri::command]
pub(crate) fn stop_mic_capture(capture_id: String) {
    let _guard = OPERATIONS.lock().unwrap_or_else(|error| error.into_inner());
    if capture_id == CONFIGURED_MONITOR {
        return;
    }
    remove_target(&capture_id, None);
    if !frontend_active() {
        restore_monitor(&AppConfig::load());
    }
}
