use app_core::AppConfig;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::ipc::Channel;
use tracing::{info, warn};
use ts_rs::TS;

/// Worker drains the cpal queue in fixed-size chunks before forwarding to the
/// JS side; smaller chunks lower IPC latency at the cost of more sends/sec.
const SAMPLE_CHUNK: usize = 512;
const PCM_QUEUE_CAP: usize = 24_000;
const MONITOR_START_BUFFER: usize = 512;
const DEFAULT_MONITOR_GAIN: f32 = 0.65;
const MAX_MONITOR_GAIN: f32 = 2.0;

/// cpal maps `BufferSize::Fixed(x)` to an ALSA period of `x` frames with a
/// buffer of `2x` frames, so the monitor round trip is roughly three periods
/// (capture period + queue prefill + playback buffer). 512 frames at 48 kHz
/// is a ~10.7 ms period and a ~32 ms round trip, which stays responsive for
/// live monitoring over USB.
const MONITOR_BUFFER_LADDER: [u32; 4] = [512, 1024, 2048, 4096];
/// A monitor stream that runs this long without an xrun/POLLERR is considered
/// stable, so the worker steps one rung back down toward the low-latency target.
const MONITOR_STABLE_RUN: std::time::Duration = std::time::Duration::from_secs(60);

static MONITOR_GAIN_BITS: AtomicU32 = AtomicU32::new(DEFAULT_MONITOR_GAIN.to_bits());
static MIC_STREAM_FAILED: AtomicBool = AtomicBool::new(false);
/// Set by the worker when it wants a stream rebuilt at the current buffer step
/// without escalating (used for the stability recovery step-down).
static MIC_RECONFIGURE: AtomicBool = AtomicBool::new(false);
static MONITOR_BUFFER_STEP: AtomicUsize = AtomicUsize::new(0);
/// Lowest ladder step that failed shortly after a recovery step-down. Recovery
/// never retries that step or lower, so a device that cannot sustain a small
/// period settles at the stable size instead of oscillating every window.
static MONITOR_RECOVERY_FLOOR: AtomicUsize = AtomicUsize::new(usize::MAX);
static LAST_MONITOR_DEVICE: once_cell::sync::Lazy<Mutex<Option<String>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

fn report_stream_error(error: cpal::StreamError) {
    // ALSA can keep reporting POLLERR after an underrun. Log it once and let
    // the worker recreate the streams instead of spinning and filling disk.
    if !MIC_STREAM_FAILED.swap(true, Ordering::Relaxed) {
        warn!("[mic] stream failed; reopening audio devices: {error}");
    }
}

fn monitor_buffer_step() -> usize {
    MONITOR_BUFFER_STEP
        .load(Ordering::Relaxed)
        .min(MONITOR_BUFFER_LADDER.len() - 1)
}

/// Raise the monitor buffer one rung after a stream failure, capped at the top
/// of the ladder so the size can never grow without bound.
fn escalate_monitor_buffer() {
    let step = monitor_buffer_step();
    let last = MONITOR_BUFFER_LADDER.len() - 1;
    if step < last {
        MONITOR_BUFFER_STEP.store(step + 1, Ordering::Relaxed);
        info!(
            "[mic] monitor buffer raised to {} frames after stream error",
            MONITOR_BUFFER_LADDER[step + 1]
        );
    }
}

/// Step back down toward the low-latency target once the current size has run
/// stably, unless a previous recovery to that size failed immediately.
/// Returns `true` only when the step actually changed, so the worker rebuilds
/// the streams just once per recovery instead of retrying a floored size.
fn recover_monitor_buffer() -> bool {
    let step = monitor_buffer_step();
    let floor = MONITOR_RECOVERY_FLOOR.load(Ordering::Relaxed);
    if step > 0 && (floor == usize::MAX || step - 1 > floor) {
        MONITOR_BUFFER_STEP.store(step - 1, Ordering::Relaxed);
        info!(
            "[mic] monitor buffer recovered to {} frames after a stable run",
            MONITOR_BUFFER_LADDER[step - 1]
        );
        true
    } else {
        false
    }
}

fn monitor_buffer_size(config: &cpal::SupportedStreamConfig) -> cpal::BufferSize {
    let target = MONITOR_BUFFER_LADDER[monitor_buffer_step()];
    match config.buffer_size() {
        cpal::SupportedBufferSize::Range { min, max } => {
            cpal::BufferSize::Fixed(target.clamp(*min, *max))
        }
        cpal::SupportedBufferSize::Unknown => cpal::BufferSize::Default,
    }
}

/// Buffer-size learning is device-specific: a recovery floor learned against one
/// interface must not pin a different interface to a larger period, and a new
/// device should be re-learned from the low-latency target.
fn reset_monitor_buffer_state_if_device_changed(device_name: &str) {
    let mut last = LAST_MONITOR_DEVICE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if last.as_deref() != Some(device_name) {
        MONITOR_BUFFER_STEP.store(0, Ordering::Relaxed);
        MONITOR_RECOVERY_FLOOR.store(usize::MAX, Ordering::Relaxed);
        *last = Some(device_name.to_string());
    }
}

type SampleSink = Arc<dyn Fn(&[f32]) + Send + Sync>;
type SampleSource = Arc<Mutex<Box<dyn FnMut() -> f32 + Send>>>;

fn monitor_gain() -> f32 {
    f32::from_bits(MONITOR_GAIN_BITS.load(Ordering::Relaxed))
}

pub(crate) fn set_monitor_gain(gain: f32) {
    let clamped = gain.clamp(0.0, MAX_MONITOR_GAIN);
    MONITOR_GAIN_BITS.store(clamped.to_bits(), Ordering::Relaxed);
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub(crate) struct MicrophoneInfo {
    pub id: String,
    pub name: String,
    pub host: String,
}

/// Mono PCM frame streamed from Rust to JS. JS owns all DSP (pitch, reactive
/// analysis) and runs it on a sliding window built from these frames.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct MicSampleFrame {
    pub sample_rate: u32,
    pub samples: Vec<f32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(default)]
#[derive(Default)]
pub(crate) struct MicCaptureOptions {
    pub emit_audio: bool,
}

fn device_display_name(device: &cpal::Device) -> String {
    let Ok(desc) = device.description() else {
        return "(unknown)".into();
    };
    if let Some(friendly) = desc.extended().first() {
        return friendly.clone();
    }
    desc.to_string()
}

/// Returns all available audio host APIs on this platform with human-readable labels.
/// On Windows: includes both WASAPI and ASIO (when available)
/// On other platforms: uses the platform's default audio API
fn audio_hosts() -> Vec<(cpal::HostId, &'static str)> {
    cpal::available_hosts()
        .into_iter()
        .map(|id| {
            let label = match id {
                #[cfg(windows)]
                cpal::HostId::Wasapi => "WASAPI",
                #[cfg(windows)]
                cpal::HostId::Asio => "ASIO",
                #[cfg(not(windows))]
                _ => id.name(),
            };
            (id, label)
        })
        .collect()
}

/// Discovers all available input microphones across all audio host APIs.
/// Devices retain their host-qualified IDs so identically named WASAPI, ASIO,
/// and virtual inputs remain independently selectable.
#[tauri::command]
pub(crate) fn list_microphones() -> Result<Vec<MicrophoneInfo>, String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    let mut errors = Vec::new();

    for (host_id, host_name) in audio_hosts() {
        let Ok(host) = cpal::host_from_id(host_id) else {
            continue;
        };
        let devices = match host.input_devices() {
            Ok(devices) => devices,
            Err(error) => {
                errors.push(format!("{host_name}: {error}"));
                continue;
            }
        };

        for device in devices {
            if device.default_input_config().is_err() {
                continue;
            }

            let name = device_display_name(&device);
            let raw_id = device
                .id()
                .map(|id| id.to_string())
                .unwrap_or_else(|_| name.clone());
            let id = format!("{host_name}:{raw_id}");
            if seen.insert(id.clone()) {
                out.push(MicrophoneInfo {
                    id,
                    name,
                    host: host_name.to_string(),
                });
            }
        }
    }

    if out.is_empty() && !errors.is_empty() {
        Err(format!("input devices: {}", errors.join("; ")))
    } else {
        Ok(out)
    }
}

fn i16_to_f32(sample: i16) -> f32 {
    sample as f32 / i16::MAX as f32
}

fn i32_to_f32(sample: i32) -> f32 {
    sample as f32 / i32::MAX as f32
}

fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

fn f32_to_u16(sample: f32) -> u16 {
    ((sample.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16
}

fn f32_to_i32(sample: f32) -> i32 {
    (sample.clamp(-1.0, 1.0) * i32::MAX as f32) as i32
}

fn f32_to_u32(sample: f32) -> u32 {
    ((sample.clamp(-1.0, 1.0) * 0.5 + 0.5) * u32::MAX as f32) as u32
}

fn push_mapped_input<T, F>(data: &[T], push: &SampleSink, mut map: F)
where
    T: Copy,
    F: FnMut(T) -> f32,
{
    let floats: Vec<f32> = data.iter().copied().map(&mut map).collect();
    push(&floats);
}

fn mix_input_frame(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }

    // USB interfaces expose each microphone jack as a separate channel. Mix
    // every connected microphone instead of selecting only whichever channel
    // happened to be loudest in the current callback. Averaging preserves
    // headroom even when both microphones receive the same loud signal.
    frame.iter().copied().sum::<f32>() / frame.len() as f32
}

fn write_output_frames<T, F>(
    data: &mut [T],
    channels: usize,
    next_sample: &SampleSource,
    mut map: F,
) where
    T: Copy,
    F: FnMut(f32) -> T,
{
    let Ok(mut next_sample) = next_sample.try_lock() else {
        for sample in data {
            *sample = map(0.0);
        }
        return;
    };

    for frame in data.chunks_mut(channels) {
        let out_sample = map(next_sample());
        for out in frame {
            *out = out_sample;
        }
    }
}

static MIC_RUNNING: AtomicBool = AtomicBool::new(false);
static MIC_SHUTDOWN: once_cell::sync::Lazy<Arc<AtomicBool>> =
    once_cell::sync::Lazy::new(|| Arc::new(AtomicBool::new(false)));
static MONITOR_ENABLED: AtomicBool = AtomicBool::new(false);
static MIC_CHANNEL: once_cell::sync::Lazy<Arc<Mutex<Option<Channel<MicSampleFrame>>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));
static MIC_THREAD: once_cell::sync::Lazy<Mutex<Option<JoinHandle<()>>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));
/// Serializes start/stop so concurrent IPC dispatches can't interleave a
/// teardown with a fresh spawn.
static MIC_OP_LOCK: once_cell::sync::Lazy<Mutex<()>> =
    once_cell::sync::Lazy::new(|| Mutex::new(()));
static MIC_MONITOR_WATCHDOG: std::sync::Once = std::sync::Once::new();

fn take_mic_thread() -> Option<JoinHandle<()>> {
    MIC_THREAD.lock().unwrap_or_else(|p| p.into_inner()).take()
}

fn stop_internal() {
    MIC_SHUTDOWN.store(true, Ordering::SeqCst);
    MONITOR_ENABLED.store(false, Ordering::SeqCst);
    /*
     * Drop the channel before joining: this triggers Tauri's `Channel` Drop,
     * which sends `{end: true}` to JS so the callback id is unregistered
     * cleanly. The mic loop also gets `None` next iteration and stops sending.
     */
    if let Ok(mut slot) = MIC_CHANNEL.lock() {
        *slot = None;
    }
    if let Some(handle) = take_mic_thread() {
        let _ = handle.join();
    }
    MIC_RUNNING.store(false, Ordering::SeqCst);
}

fn find_device(preferred: Option<&str>) -> Result<(cpal::Device, String), String> {
    if let Some(preference) = preferred {
        let hosts = audio_hosts();
        let qualified_preference = preference.split_once(':').filter(|(preferred_host, _)| {
            hosts
                .iter()
                .any(|(_, host_name)| host_name == preferred_host)
        });

        for (host_id, host_name) in hosts {
            if qualified_preference.is_some_and(|(preferred_host, _)| preferred_host != host_name) {
                continue;
            }

            let Ok(host) = cpal::host_from_id(host_id) else {
                continue;
            };
            let Ok(devices) = host.input_devices() else {
                continue;
            };
            for dev in devices {
                let display_name = device_display_name(&dev);
                let raw_id = dev
                    .id()
                    .map(|id| id.to_string())
                    .unwrap_or_else(|_| display_name.clone());
                let id_matches = qualified_preference.map_or_else(
                    || raw_id == preference,
                    |(_, preferred_id)| raw_id == preferred_id,
                );
                // Name matching preserves preferences saved by older versions.
                if id_matches || (qualified_preference.is_none() && display_name == preference) {
                    return Ok((dev, display_name));
                }
            }
        }
        return Err(format!("Microphone '{preference}' not found"));
    }

    // No preference: use the system default input device
    let device = cpal::default_host()
        .default_input_device()
        .ok_or_else(|| "No default microphone found".to_string())?;
    let name = device_display_name(&device);
    Ok((device, name))
}

#[tauri::command]
pub(crate) fn start_mic_capture(
    preferred: Option<String>,
    options: Option<MicCaptureOptions>,
    on_samples: Channel<MicSampleFrame>,
) -> Result<String, String> {
    let _guard = MIC_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());

    start_mic_capture_internal(
        preferred,
        options.unwrap_or_default().emit_audio,
        Some(on_samples),
    )
}

fn start_mic_capture_internal(
    preferred: Option<String>,
    emit_audio: bool,
    on_samples: Option<Channel<MicSampleFrame>>,
) -> Result<String, String> {
    /*
     * Always tear down any prior session first. We used to short-circuit with
     * "already running" if MIC_RUNNING was true, but that hit a race where
     * the previous worker had already broken out on shutdown but not yet
     * cleared MIC_RUNNING — the new start would skip spawning, and capture
     * would silently die for the rest of the session.
     */
    stop_internal();

    MONITOR_ENABLED.store(emit_audio, Ordering::SeqCst);

    let (device, name) = match find_device(preferred.as_deref()) {
        Ok(pair) => pair,
        Err(e) => {
            MONITOR_ENABLED.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };

    if let Ok(mut slot) = MIC_CHANNEL.lock() {
        *slot = on_samples;
    }

    MIC_SHUTDOWN.store(false, Ordering::SeqCst);
    MIC_RUNNING.store(true, Ordering::SeqCst);

    let device_name = name.clone();
    let shutdown = Arc::clone(&MIC_SHUTDOWN);

    let handle = std::thread::spawn(move || {
        // True while the current run uses a size we just stepped down to. If
        // that run fails quickly, the smaller period is unsustainable here.
        let mut recovering = false;
        while !shutdown.load(Ordering::Relaxed) {
            MIC_STREAM_FAILED.store(false, Ordering::Relaxed);
            MIC_RECONFIGURE.store(false, Ordering::Relaxed);
            let run_started = std::time::Instant::now();
            run_mic_loop(&device, &name, Arc::clone(&shutdown));
            if shutdown.load(Ordering::Relaxed) {
                break;
            }
            if MIC_STREAM_FAILED.load(Ordering::Relaxed) {
                if recovering && run_started.elapsed() < MONITOR_STABLE_RUN {
                    let failed_step = monitor_buffer_step();
                    MONITOR_RECOVERY_FLOOR.fetch_min(failed_step, Ordering::Relaxed);
                    info!(
                        "[mic] monitor buffer {} frames unsustainable; recovery floor set",
                        MONITOR_BUFFER_LADDER[failed_step]
                    );
                }
                recovering = false;
                escalate_monitor_buffer();
            } else if MIC_RECONFIGURE.load(Ordering::Relaxed) {
                recovering = true;
            } else {
                break;
            }
            for _ in 0..25 {
                if shutdown.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
        MIC_RUNNING.store(false, Ordering::SeqCst);
    });

    if let Ok(mut slot) = MIC_THREAD.lock() {
        *slot = Some(handle);
    }

    Ok(device_name)
}

/// Start speaker monitoring as part of native application startup. Playback
/// later restarts the same capture worker with a Tauri channel attached, so
/// pitch analysis and monitoring continue to share one exclusive ALSA input.
pub(crate) fn start_configured_monitor(config: &AppConfig) {
    let _guard = MIC_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    start_configured_monitor_internal(config);
    MIC_MONITOR_WATCHDOG.call_once(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            if MIC_RUNNING.load(Ordering::SeqCst) {
                continue;
            }
            let _guard = MIC_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
            if MIC_RUNNING.load(Ordering::SeqCst)
                || MIC_CHANNEL
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .is_some()
            {
                continue;
            }
            let config = AppConfig::load();
            if config.mic_monitoring == Some(true)
                && start_mic_capture_internal(config.preferred_mic, true, None).is_ok()
            {
                info!("[mic] configured monitor recovered after device appeared");
            }
        });
    });
}

fn start_configured_monitor_internal(config: &AppConfig) {
    if config.mic_monitoring != Some(true) {
        return;
    }

    if let Err(error) = start_mic_capture_internal(config.preferred_mic.clone(), true, None) {
        warn!("[mic] startup monitor failed: {error}");
    }
}

/// Apply settings immediately when the native monitor owns capture. An
/// attached frontend capture (including microphone tests) owns its own
/// options until it releases the channel.
pub(crate) fn update_configured_monitor(config: &AppConfig) {
    let _guard = MIC_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    if MIC_CHANNEL
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .is_none()
    {
        stop_internal();
        start_configured_monitor_internal(config);
    }
}

fn try_build_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    pcm_shared: Arc<Mutex<VecDeque<f32>>>,
    audio_shared: Arc<Mutex<VecDeque<f32>>>,
) -> Option<cpal::Stream> {
    let ch = config.channels as usize;
    let monitor_queue_cap = match config.buffer_size {
        cpal::BufferSize::Fixed(period) => period as usize * 2,
        cpal::BufferSize::Default => MONITOR_START_BUFFER * 2,
    };
    let push_samples: SampleSink = {
        let pcm_cb = Arc::clone(&pcm_shared);
        let audio_cb = Arc::clone(&audio_shared);
        Arc::new(move |data: &[f32]| {
            let mut mono_samples = Vec::with_capacity(data.len() / ch.max(1));
            for frame in data.chunks(ch) {
                mono_samples.push(mix_input_frame(frame));
            }

            if let Ok(mut q) = pcm_cb.try_lock() {
                for sample in &mono_samples {
                    q.push_back(*sample);
                }
                while q.len() > PCM_QUEUE_CAP {
                    q.pop_front();
                }
            }

            if MONITOR_ENABLED.load(Ordering::Relaxed) {
                if let Ok(mut q) = audio_cb.try_lock() {
                    for sample in &mono_samples {
                        q.push_back(*sample);
                    }
                    // USB input and HDMI output have independent clocks. Keep
                    // only recent audio so clock drift cannot become vocal lag.
                    while q.len() > monitor_queue_cap {
                        q.pop_front();
                    }
                }
            }
        })
    };

    use cpal::SampleFormat;
    let stream = match sample_format {
        SampleFormat::F32 => {
            let push = push_samples.clone();
            device.build_input_stream(
                config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| push(data),
                report_stream_error,
                None,
            )
        }
        SampleFormat::I16 => {
            let push = push_samples.clone();
            device.build_input_stream(
                config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    push_mapped_input(data, &push, i16_to_f32);
                },
                report_stream_error,
                None,
            )
        }
        SampleFormat::I32 => {
            let push = push_samples.clone();
            device.build_input_stream(
                config,
                move |data: &[i32], _: &cpal::InputCallbackInfo| {
                    push_mapped_input(data, &push, i32_to_f32);
                },
                report_stream_error,
                None,
            )
        }
        _ => return None,
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            warn!("[mic] build stream failed: {e}");
            return None;
        }
    };

    if let Err(e) = stream.play() {
        warn!("[mic] play failed: {e}");
        return None;
    }

    Some(stream)
}

fn try_build_output_stream(
    device: &cpal::Device,
    input_sample_rate: cpal::SampleRate,
    audio_shared: Arc<Mutex<VecDeque<f32>>>,
) -> Option<cpal::Stream> {
    let default_cfg = match device.default_output_config() {
        Ok(c) => c,
        Err(e) => {
            warn!("[mic] output config error: {e}");
            return None;
        }
    };
    let default_cfg = device
        .supported_output_configs()
        .ok()
        .and_then(|mut configs| {
            configs.find(|candidate| {
                candidate.channels() == default_cfg.channels()
                    && candidate.sample_format() == default_cfg.sample_format()
                    && candidate.min_sample_rate() <= 48_000
                    && candidate.max_sample_rate() >= 48_000
            })
        })
        .map_or(default_cfg, |config| config.with_sample_rate(48_000));
    let sample_format = default_cfg.sample_format();
    let config = cpal::StreamConfig {
        channels: default_cfg.channels(),
        sample_rate: default_cfg.sample_rate(),
        buffer_size: monitor_buffer_size(&default_cfg),
    };
    let ch = config.channels as usize;
    let sample_rate_ratio = f64::from(input_sample_rate) / f64::from(config.sample_rate);

    let next_sample: SampleSource = {
        let audio_shared = Arc::clone(&audio_shared);
        let mut current = 0.0;
        let mut next = 0.0;
        let mut position = 0.0;
        let mut initialized = false;
        let mut buffered = VecDeque::new();
        Arc::new(Mutex::new(Box::new(move || -> f32 {
            if !MONITOR_ENABLED.load(Ordering::Relaxed) {
                return 0.0;
            }

            if !initialized {
                let Ok(mut queue) = audio_shared.try_lock() else {
                    return 0.0;
                };
                if queue.len() < MONITOR_START_BUFFER {
                    return 0.0;
                }
                buffered.extend(queue.drain(..));
                current = buffered.pop_front().unwrap_or(0.0);
                next = buffered.pop_front().unwrap_or(0.0);
                initialized = true;
            }

            let sample = current + (next - current) * position as f32;
            position += sample_rate_ratio;
            while position >= 1.0 {
                current = next;
                if buffered.is_empty() {
                    if let Ok(mut queue) = audio_shared.try_lock() {
                        buffered.extend(queue.drain(..));
                    }
                }
                next = buffered.pop_front().unwrap_or(0.0);
                position -= 1.0;
            }

            sample * monitor_gain()
        })))
    };

    use cpal::SampleFormat;
    let stream = match sample_format {
        SampleFormat::F32 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                &config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, |sample| sample);
                },
                report_stream_error,
                None,
            )
        }
        SampleFormat::I16 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                &config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, f32_to_i16);
                },
                report_stream_error,
                None,
            )
        }
        SampleFormat::U16 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                &config,
                move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, f32_to_u16);
                },
                report_stream_error,
                None,
            )
        }
        SampleFormat::I32 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                &config,
                move |data: &mut [i32], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, f32_to_i32);
                },
                report_stream_error,
                None,
            )
        }
        SampleFormat::U32 => {
            let next = Arc::clone(&next_sample);
            device.build_output_stream(
                &config,
                move |data: &mut [u32], _: &cpal::OutputCallbackInfo| {
                    write_output_frames(data, ch, &next, f32_to_u32);
                },
                report_stream_error,
                None,
            )
        }
        _ => {
            warn!("[mic] unsupported output sample format: {sample_format:?}");
            return None;
        }
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            warn!("[mic] build output stream failed: {e}");
            return None;
        }
    };
    if let Err(e) = stream.play() {
        warn!("[mic] output play failed: {e}");
        return None;
    }
    Some(stream)
}

fn drain_chunk(queue: &Mutex<VecDeque<f32>>) -> Option<Vec<f32>> {
    let mut q = queue.try_lock().ok()?;
    if q.len() < SAMPLE_CHUNK {
        return None;
    }
    Some(q.drain(..SAMPLE_CHUNK).collect())
}

fn run_mic_loop(device: &cpal::Device, name: &str, shutdown: Arc<AtomicBool>) {
    reset_monitor_buffer_state_if_device_changed(name);

    let default_cfg = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            warn!("[mic] '{name}' config error: {e}");
            return;
        }
    };

    // Prefer the common HDMI/video rate when the input supports it. Some USB
    // interfaces advertise 44.1 kHz as their default even when that clock
    // source cannot currently be activated (observed on UMC202HD).
    let input_cfg = device
        .supported_input_configs()
        .ok()
        .and_then(|mut configs| {
            configs.find(|candidate| {
                candidate.channels() == default_cfg.channels()
                    && candidate.sample_format() == default_cfg.sample_format()
                    && candidate.min_sample_rate() <= 48_000
                    && candidate.max_sample_rate() >= 48_000
            })
        })
        .map_or(default_cfg, |config| config.with_sample_rate(48_000));
    let sample_format = input_cfg.sample_format();
    let config = cpal::StreamConfig {
        channels: input_cfg.channels(),
        sample_rate: input_cfg.sample_rate(),
        buffer_size: monitor_buffer_size(&input_cfg),
    };
    let sr = config.sample_rate;

    info!(
        "[mic] opening '{name}': {sr} Hz, {}ch, {sample_format:?}",
        config.channels
    );

    let pcm_shared = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(PCM_QUEUE_CAP)));
    let audio_shared = Arc::new(Mutex::new(VecDeque::<f32>::new()));
    let Some(_stream) = try_build_stream(
        device,
        &config,
        sample_format,
        Arc::clone(&pcm_shared),
        Arc::clone(&audio_shared),
    ) else {
        warn!("[mic] failed to open '{name}'");
        return;
    };
    let monitor_stream = if MONITOR_ENABLED.load(Ordering::Relaxed) {
        cpal::default_host()
            .default_output_device()
            .and_then(|output_device| {
                try_build_output_stream(&output_device, sr, Arc::clone(&audio_shared))
            })
    } else {
        None
    };
    if MONITOR_ENABLED.load(Ordering::Relaxed) && monitor_stream.is_none() {
        warn!("[mic] no output monitoring stream available");
    }

    info!("[mic] active: {name}");

    let sleep_dur = std::time::Duration::from_millis(4);
    let run_started = std::time::Instant::now();

    loop {
        std::thread::sleep(sleep_dur);

        if shutdown.load(Ordering::Relaxed) || MIC_STREAM_FAILED.load(Ordering::Relaxed) {
            break;
        }

        // A long clean run at an escalated size means the device can afford a
        // smaller period again: hand control back to the worker so it can
        // rebuild both streams one rung closer to the low-latency target.
        if run_started.elapsed() >= MONITOR_STABLE_RUN && recover_monitor_buffer() {
            MIC_RECONFIGURE.store(true, Ordering::Relaxed);
            break;
        }

        while let Some(samples) = drain_chunk(&pcm_shared) {
            let channel = MIC_CHANNEL.lock().ok().and_then(|s| s.clone());
            if let Some(channel) = channel {
                let frame = MicSampleFrame {
                    sample_rate: sr,
                    samples,
                };
                if let Err(e) = channel.send(frame) {
                    warn!("[mic] channel send failed: {e}");
                }
            }
        }
    }
}

#[tauri::command]
pub(crate) fn stop_mic_capture() {
    let _guard = MIC_OP_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    stop_internal();
    // Releasing frontend capture returns to the application's saved monitor
    // preference, including after leaving playback or finishing a mic test.
    start_configured_monitor_internal(&AppConfig::load());
}

#[cfg(test)]
mod tests {
    use super::mix_input_frame;

    #[test]
    fn both_microphone_inputs_contribute_without_overloading_the_mix() {
        assert_eq!(mix_input_frame(&[]), 0.0);
        assert_eq!(mix_input_frame(&[0.75]), 0.75);
        assert_eq!(mix_input_frame(&[0.8, 0.0]), 0.4);
        assert_eq!(mix_input_frame(&[0.0, 0.8]), 0.4);
        assert_eq!(mix_input_frame(&[1.0, 1.0]), 1.0);
        assert_eq!(mix_input_frame(&[-1.0, -1.0]), -1.0);
    }
}
