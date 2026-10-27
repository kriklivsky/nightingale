use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::{Producer, RingBuffer};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use tracing::{info, warn};
use ts_rs::TS;

mod buffering;
mod capture;
mod samples;

use buffering::Direction;
pub(crate) use capture::{
    start_configured_monitor, start_mic_capture, stop_mic_capture, update_configured_monitor,
    update_mic_capture_options,
};
use capture::{AudioState, CaptureTargets};
use samples::{InputSamples, OutputSamples};

/// Worker drains the cpal queue in fixed-size chunks before forwarding to the
/// JS side; smaller chunks lower IPC latency at the cost of more sends/sec.
const SAMPLE_CHUNK: usize = 512;
const PCM_QUEUE_CAP: usize = 24_000;
const DEFAULT_PERIOD_FRAMES: usize = 512;
const DEFAULT_MONITOR_GAIN: f32 = 0.65;
const MAX_MONITOR_GAIN: f32 = 2.0;

static MONITOR_GAIN_BITS: AtomicU32 = AtomicU32::new(DEFAULT_MONITOR_GAIN.to_bits());
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
    pub channel_count: u16,
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
        return friendly.to_string();
    }
    desc.to_string()
}

fn audio_host_name(id: cpal::HostId) -> &'static str {
    let name = match id {
        #[cfg(windows)]
        cpal::HostId::Wasapi => "WASAPI",
        #[cfg(windows)]
        cpal::HostId::Asio => "ASIO",
        #[cfg(not(windows))]
        _ => id.name(),
    };
    match name {
        "ALSA" => "Alsa",
        _ => name,
    }
}

/// Returns all available audio host APIs on this platform with human-readable labels.
/// On Windows: includes both WASAPI and ASIO (when available)
/// On other platforms: uses the platform's default audio API
fn audio_hosts() -> Vec<(cpal::HostId, &'static str)> {
    cpal::available_hosts()
        .into_iter()
        .map(|id| (id, audio_host_name(id)))
        .collect()
}

/// Discovers all available input microphones across all audio host APIs.
/// Devices retain their host-qualified IDs so identically named WASAPI, ASIO,
/// and virtual inputs remain independently selectable.
#[tauri::command]
pub(crate) fn list_microphones(
    combine_channels: Option<bool>,
) -> Result<Vec<MicrophoneInfo>, String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    let mut errors = Vec::new();

    for (host_id, host_name) in audio_hosts() {
        let Ok(host) = cpal::host_from_id(host_id) else {
            continue;
        };
        let devices = match host.devices() {
            Ok(devices) => devices,
            Err(error) => {
                errors.push(format!("{host_name}: {error}"));
                continue;
            }
        };

        for device in devices {
            let name = device_display_name(&device);
            let raw_id = device
                .id()
                .map(|id| id.to_string())
                .unwrap_or_else(|_| name.clone());
            let host = host_name.to_string();
            let id = format!("{host_name}:{raw_id}");
            let channel_count = capture::active_input_channels(&id)
                .and_then(|channels| u16::try_from(channels).ok())
                .or_else(|| {
                    device
                        .default_input_config()
                        .ok()
                        .map(|config| config.channels())
                });
            let Some(channel_count) = channel_count else {
                continue;
            };
            if seen.insert(id.clone()) {
                if combine_channels.unwrap_or(true) || channel_count <= 1 {
                    out.push(MicrophoneInfo {
                        id,
                        name,
                        host,
                        channel_count,
                    });
                } else {
                    for channel in 1..=channel_count {
                        out.push(MicrophoneInfo {
                            id: format!("{id}#channel={channel}"),
                            name: format!("{name} (Channel {channel})"),
                            host: host.clone(),
                            channel_count,
                        });
                    }
                }
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

fn selected_input_channel(preference: &str) -> (&str, Option<usize>) {
    let Some((device_id, channel)) = preference.rsplit_once("#channel=") else {
        return (preference, None);
    };
    let Some(channel) = channel
        .parse::<usize>()
        .ok()
        .and_then(|channel| channel.checked_sub(1))
    else {
        return (preference, None);
    };
    (device_id, Some(channel))
}

struct ResolvedInputDevice {
    device: cpal::Device,
    id: String,
    name: String,
    selected_channel: Option<usize>,
}

fn find_device(preferred: Option<&str>) -> Result<ResolvedInputDevice, String> {
    if let Some(preference) = preferred {
        let (device_preference, selected_channel) = selected_input_channel(preference);
        let hosts = audio_hosts();
        let qualified_preference =
            device_preference
                .split_once(':')
                .filter(|(preferred_host, _)| {
                    hosts
                        .iter()
                        .any(|(_, host_name)| host_name.eq_ignore_ascii_case(preferred_host))
                });

        for (host_id, host_name) in hosts {
            if qualified_preference
                .is_some_and(|(preferred_host, _)| !preferred_host.eq_ignore_ascii_case(host_name))
            {
                continue;
            }

            let Ok(host) = cpal::host_from_id(host_id) else {
                continue;
            };
            let Ok(devices) = host.devices() else {
                continue;
            };
            for dev in devices {
                let display_name = device_display_name(&dev);
                let raw_id = dev
                    .id()
                    .map(|id| id.to_string())
                    .unwrap_or_else(|_| display_name.clone());
                let id_matches = qualified_preference.map_or_else(
                    || raw_id == device_preference,
                    |(_, preferred_id)| raw_id == preferred_id,
                );
                // Name matching preserves preferences saved by older versions.
                if id_matches
                    || (qualified_preference.is_none() && display_name == device_preference)
                {
                    let id = format!("{host_name}:{raw_id}");
                    if capture::active_input_channels(&id).is_none()
                        && dev.default_input_config().is_err()
                    {
                        continue;
                    }
                    return Ok(ResolvedInputDevice {
                        device: dev,
                        id,
                        name: display_name,
                        selected_channel,
                    });
                }
            }
        }
        return Err(format!("Microphone '{preference}' not found"));
    }

    // No preference: use the system default input device
    let host = cpal::default_host();
    let host_name = audio_host_name(host.id());
    let device = host
        .default_input_device()
        .ok_or_else(|| "No default microphone found".to_string())?;
    let name = device_display_name(&device);
    let raw_id = device
        .id()
        .map(|id| id.to_string())
        .unwrap_or_else(|_| name.clone());
    Ok(ResolvedInputDevice {
        device,
        id: format!("{host_name}:{raw_id}"),
        name,
        selected_channel: None,
    })
}

fn try_build_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    mut samples: InputSamples,
    state: &Arc<AudioState>,
) -> Option<cpal::Stream> {
    let ch = config.channels as usize;
    let errors = Arc::clone(state);

    use cpal::SampleFormat;
    let stream = match sample_format {
        SampleFormat::F32 => device.build_input_stream(
            config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                samples.push(data, ch, |sample| sample)
            },
            move |error| errors.report_error(error, Direction::Input),
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                samples.push(data, ch, i16_to_f32);
            },
            move |error| errors.report_error(error, Direction::Input),
            None,
        ),
        SampleFormat::I32 => device.build_input_stream(
            config,
            move |data: &[i32], _: &cpal::InputCallbackInfo| {
                samples.push(data, ch, i32_to_f32);
            },
            move |error| errors.report_error(error, Direction::Input),
            None,
        ),
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
    input_period: usize,
    state: &Arc<AudioState>,
) -> Option<(cpal::Stream, Producer<f32>)> {
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
        buffer_size: state
            .buffers
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .buffer_size(Direction::Output, &default_cfg),
    };
    let ch = config.channels as usize;
    let sample_rate_ratio = f64::from(input_sample_rate) / f64::from(config.sample_rate);
    let output_period = match config.buffer_size {
        cpal::BufferSize::Fixed(period) => (f64::from(period) * sample_rate_ratio).ceil() as usize,
        cpal::BufferSize::Default => DEFAULT_PERIOD_FRAMES,
    };
    let capacity = input_period.max(output_period).max(DEFAULT_PERIOD_FRAMES) * 2;
    let (monitor_input, audio) = RingBuffer::new(capacity);

    info!(
        "[mic] opening monitor output: {} Hz, {}ch, {sample_format:?}, period request {:?}",
        config.sample_rate, config.channels, config.buffer_size
    );

    let mut samples = OutputSamples::new(audio, sample_rate_ratio, Arc::clone(state));
    let errors = Arc::clone(state);

    use cpal::SampleFormat;
    let stream = match sample_format {
        SampleFormat::F32 => device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                samples.write(data, ch, |sample| sample);
            },
            move |error| errors.report_error(error, Direction::Output),
            None,
        ),
        SampleFormat::I16 => device.build_output_stream(
            &config,
            move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                samples.write(data, ch, f32_to_i16);
            },
            move |error| errors.report_error(error, Direction::Output),
            None,
        ),
        SampleFormat::U16 => device.build_output_stream(
            &config,
            move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                samples.write(data, ch, f32_to_u16);
            },
            move |error| errors.report_error(error, Direction::Output),
            None,
        ),
        SampleFormat::I32 => device.build_output_stream(
            &config,
            move |data: &mut [i32], _: &cpal::OutputCallbackInfo| {
                samples.write(data, ch, f32_to_i32);
            },
            move |error| errors.report_error(error, Direction::Output),
            None,
        ),
        SampleFormat::U32 => device.build_output_stream(
            &config,
            move |data: &mut [u32], _: &cpal::OutputCallbackInfo| {
                samples.write(data, ch, f32_to_u32);
            },
            move |error| errors.report_error(error, Direction::Output),
            None,
        ),
        _ => {
            warn!("[mic] unsupported output sample format: {sample_format:?}");
            return None;
        }
    };
    let stream = match stream {
        Ok(stream) => stream,
        Err(error) => {
            warn!("[mic] build output stream failed: {error}");
            return None;
        }
    };
    if let Err(error) = stream.play() {
        warn!("[mic] output play failed: {error}");
        return None;
    }
    Some((stream, monitor_input))
}

fn run_mic_loop(
    device: &cpal::Device,
    name: &str,
    state: &Arc<AudioState>,
    targets: &CaptureTargets,
    startup: &mut Option<mpsc::SyncSender<Result<(), String>>>,
) -> Result<(), String> {
    state
        .buffers
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .begin_run(name);
    let default_cfg = device
        .default_input_config()
        .map_err(|error| format!("Input configuration unavailable: {error}"))?;
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
        buffer_size: state
            .buffers
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .buffer_size(Direction::Input, &input_cfg),
    };
    let channels = usize::from(config.channels);
    if channels == 0 || channels > 64 {
        return Err("Microphone must expose between 1 and 64 channels".into());
    }
    state.input_channels.store(channels, Ordering::Relaxed);
    let sr = config.sample_rate;
    info!(
        "[mic] opening '{name}': {} Hz, {}ch, {sample_format:?}, period request {:?}",
        sr, config.channels, config.buffer_size
    );
    let input_period = match config.buffer_size {
        cpal::BufferSize::Fixed(period) => period as usize,
        cpal::BufferSize::Default => DEFAULT_PERIOD_FRAMES,
    };
    let (pcm_input, mut pcm_output) = RingBuffer::new(PCM_QUEUE_CAP * channels);
    let monitoring = state.monitor_channels.load(Ordering::Relaxed) != 0;
    let monitor = if monitoring {
        cpal::default_host()
            .default_output_device()
            .and_then(|output_device| {
                try_build_output_stream(&output_device, sr, input_period, state)
            })
    } else {
        None
    };
    let (monitor_stream, monitor_input) = match monitor {
        Some((stream, input)) => (Some(stream), Some(input)),
        None => (None, None),
    };
    let overruns = Arc::new(AtomicUsize::new(0));
    let _stream = try_build_stream(
        device,
        &config,
        sample_format,
        InputSamples::new(
            pcm_input,
            monitor_input,
            Arc::clone(&overruns),
            Arc::clone(state),
        ),
        state,
    )
    .ok_or_else(|| "Failed to open microphone input stream".to_string())?;
    if monitoring && monitor_stream.is_none() {
        warn!("[mic] no output monitoring stream available");
    }
    state.running.store(true, Ordering::Release);
    if let Some(started) = startup.take() {
        let _ = started.send(Ok(()));
    }
    info!("[mic] active: {name}");
    let mut buffer_check_at = std::time::Instant::now();
    loop {
        std::thread::sleep(std::time::Duration::from_millis(4));
        if state.shutdown.load(Ordering::Relaxed) || state.failures.load(Ordering::Relaxed) != 0 {
            break;
        }
        if !monitoring && state.monitor_channels.load(Ordering::Relaxed) != 0 {
            break;
        }
        if buffer_check_at.elapsed() >= std::time::Duration::from_secs(1) {
            buffer_check_at = std::time::Instant::now();
            let dropped = overruns.swap(0, Ordering::Relaxed);
            if dropped > 0 {
                warn!("[mic] bounded audio queues dropped {dropped} frames under load");
            }
            if state
                .buffers
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .recover(monitor_stream.is_some())
            {
                break;
            }
        }
        while pcm_output.slots() >= SAMPLE_CHUNK * channels {
            let interleaved: Vec<f32> = (0..SAMPLE_CHUNK * channels)
                .filter_map(|_| pcm_output.pop().ok())
                .collect();
            let mut energy = vec![0.0; channels];
            for frame in interleaved.chunks_exact(channels) {
                for (channel, sample) in frame.iter().enumerate() {
                    energy[channel] += sample * sample;
                }
            }
            let strongest = energy
                .iter()
                .enumerate()
                .max_by(|(_, left), (_, right)| left.total_cmp(right))
                .map_or(0, |(channel, _)| channel);
            let targets = targets.lock().unwrap_or_else(|error| error.into_inner());
            for target in targets.values() {
                let Some(channel) = target.channel.as_ref() else {
                    continue;
                };
                let selected = target.selected_channel.unwrap_or(strongest);
                if selected >= channels {
                    return Err("Requested microphone channel is no longer available".into());
                }
                let samples = interleaved
                    .chunks_exact(channels)
                    .map(|frame| frame[selected])
                    .collect();
                if let Err(error) = channel.send(MicSampleFrame {
                    sample_rate: sr,
                    samples,
                }) {
                    warn!("[mic] channel send failed: {error}");
                }
            }
        }
    }
    Ok(())
}
