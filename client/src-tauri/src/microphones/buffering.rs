use std::time::{Duration, Instant};

use tracing::info;

const BUFFER_FRAMES: [u32; 4] = [512, 1024, 2048, 4096];
const STABLE_RUN: Duration = Duration::from_secs(60);
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(300);
const MAX_RETRY_DELAY: Duration = Duration::from_secs(900);

#[derive(Clone, Copy)]
pub(super) enum Direction {
    Input,
    Output,
}

impl Direction {
    pub(super) fn mask(self) -> usize {
        match self {
            Self::Input => 1,
            Self::Output => 2,
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Input => "input",
            Self::Output => "output",
        }
    }
}

struct StreamBuffer {
    step: usize,
    stable_since: Instant,
    recovering: bool,
    retry_delay: Duration,
}

impl Default for StreamBuffer {
    fn default() -> Self {
        Self {
            step: 0,
            stable_since: Instant::now(),
            recovering: false,
            retry_delay: STABLE_RUN,
        }
    }
}

impl StreamBuffer {
    fn failed(&mut self, direction: Direction, now: Instant) {
        self.retry_delay = if self.recovering && now.duration_since(self.stable_since) < STABLE_RUN
        {
            (self.retry_delay * 2).clamp(RETRY_AFTER_FAILURE, MAX_RETRY_DELAY)
        } else {
            STABLE_RUN
        };
        self.recovering = false;
        self.stable_since = now;
        self.step = (self.step + 1).min(BUFFER_FRAMES.len() - 1);
        info!(
            "[mic] {} buffer raised to {} frames; lower-buffer retry after {} stable seconds",
            direction.label(),
            BUFFER_FRAMES[self.step],
            self.retry_delay.as_secs()
        );
    }

    fn recover(&mut self, direction: Direction, now: Instant) -> bool {
        let elapsed = now.duration_since(self.stable_since);
        if self.recovering && elapsed >= STABLE_RUN {
            self.recovering = false;
            self.retry_delay = STABLE_RUN;
        }
        if self.step == 0 || elapsed < self.retry_delay {
            return false;
        }

        self.step -= 1;
        self.stable_since = now;
        self.recovering = true;
        info!(
            "[mic] {} buffer recovered to {} frames after a stable run",
            direction.label(),
            BUFFER_FRAMES[self.step]
        );
        true
    }
}

#[derive(Default)]
pub(super) struct MonitorBuffers {
    device: Option<String>,
    input: StreamBuffer,
    output: StreamBuffer,
}

impl MonitorBuffers {
    pub(super) fn begin_run(&mut self, device: &str) {
        if self.device.as_deref() != Some(device) {
            *self = Self {
                device: Some(device.to_owned()),
                ..Self::default()
            };
        }
        let now = Instant::now();
        self.input.stable_since = now;
        self.output.stable_since = now;
    }

    pub(super) fn buffer_size(
        &self,
        direction: Direction,
        config: &cpal::SupportedStreamConfig,
    ) -> cpal::BufferSize {
        let stream = match direction {
            Direction::Input => &self.input,
            Direction::Output => &self.output,
        };
        match config.buffer_size() {
            cpal::SupportedBufferSize::Range { min, max } => {
                cpal::BufferSize::Fixed(BUFFER_FRAMES[stream.step].clamp(*min, *max))
            }
            cpal::SupportedBufferSize::Unknown => cpal::BufferSize::Default,
        }
    }

    pub(super) fn failed(&mut self, mask: usize) {
        let now = Instant::now();
        if mask & Direction::Input.mask() != 0 {
            self.input.failed(Direction::Input, now);
        }
        if mask & Direction::Output.mask() != 0 {
            self.output.failed(Direction::Output, now);
        }
    }

    pub(super) fn recover(&mut self, monitor_enabled: bool) -> bool {
        let now = Instant::now();
        let input_changed = self.input.recover(Direction::Input, now);
        let output_changed = monitor_enabled && self.output.recover(Direction::Output, now);
        input_changed || output_changed
    }
}
