use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use rtrb::{Consumer, Producer};

use super::capture::AudioState;
use super::monitor_gain;

const MONITOR_PREFILL_FRAMES: usize = 256;

pub(super) struct InputSamples {
    pcm: Producer<f32>,
    monitor: Option<Producer<f32>>,
    overruns: Arc<AtomicUsize>,
    state: Arc<AudioState>,
}

impl InputSamples {
    pub(super) fn new(
        pcm: Producer<f32>,
        monitor: Option<Producer<f32>>,
        overruns: Arc<AtomicUsize>,
        state: Arc<AudioState>,
    ) -> Self {
        Self {
            pcm,
            monitor,
            overruns,
            state,
        }
    }

    pub(super) fn push<T: Copy, F: Fn(T) -> f32>(
        &mut self,
        data: &[T],
        channels: usize,
        convert: F,
    ) {
        let monitor_channels = self.state.monitor_channels.load(Ordering::Relaxed);
        for frame in data.chunks_exact(channels) {
            let pcm_full = self.pcm.slots() < channels;
            let mut monitor_sample = 0.0;
            let mut monitored = 0;
            for (channel, value) in frame.iter().copied().enumerate() {
                let sample = convert(value);
                if !pcm_full {
                    let _ = self.pcm.push(sample);
                }
                if monitor_channels & (1 << channel) != 0 {
                    monitor_sample += sample;
                    monitored += 1;
                }
            }
            let monitor_full = monitored > 0
                && self.monitor.as_mut().is_some_and(|monitor| {
                    monitor.push(monitor_sample / monitored as f32).is_err()
                });
            if pcm_full || monitor_full {
                self.overruns.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

pub(super) struct OutputSamples {
    samples: Consumer<f32>,
    ratio: f64,
    position: f64,
    current: f32,
    next: f32,
    initialized: bool,
    state: Arc<AudioState>,
}

impl OutputSamples {
    pub(super) fn new(samples: Consumer<f32>, ratio: f64, state: Arc<AudioState>) -> Self {
        Self {
            samples,
            ratio,
            position: 0.0,
            current: 0.0,
            next: 0.0,
            initialized: false,
            state,
        }
    }

    fn next_sample(&mut self) -> f32 {
        if !self.initialized {
            if self.samples.slots() < MONITOR_PREFILL_FRAMES {
                return 0.0;
            }
            self.current = self.samples.pop().unwrap_or(0.0);
            self.next = self.samples.pop().unwrap_or(0.0);
            self.initialized = true;
        }

        let sample = self.current + (self.next - self.current) * self.position as f32;
        self.position += self.ratio;
        while self.position >= 1.0 {
            self.current = self.next;
            self.next = self.samples.pop().unwrap_or(0.0);
            self.position -= 1.0;
        }
        sample
    }

    pub(super) fn write<T: Copy, F: Fn(f32) -> T>(
        &mut self,
        data: &mut [T],
        channels: usize,
        convert: F,
    ) {
        let monitoring = self.state.monitor_channels.load(Ordering::Relaxed) != 0;
        if !monitoring {
            while self.samples.pop().is_ok() {}
            self.initialized = false;
            self.position = 0.0;
        }
        let gain = monitor_gain();
        for frame in data.chunks_mut(channels) {
            let sample = if monitoring {
                self.next_sample() * gain
            } else {
                0.0
            };
            frame.fill(convert(sample));
        }
    }
}
