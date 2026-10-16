import { useEffect, useRef, useState } from 'react';

import {
  microphoneAdapter,
  type MicCaptureOptions,
  type MicrophoneAdapter,
} from '@/bridge/microphone';
import { useMicSamples } from '@/features/microphone/hooks/use-mic-samples';
import { SampleRing } from '@/features/microphone/lib/sample-ring';
import { PITCH_WINDOW_SAMPLES } from '@/features/playback/lib/pitch/constants';
import {
  createMicPitchDetector,
  detectPitchFromSamplesMic,
} from '@/features/playback/lib/pitch/detect';

/** ~30 Hz pitch updates: more than enough for vocal pitch tracking. */
const PITCH_TICK_MS = 33;
const MAX_SAMPLE_AGE_MS = 150;
const RING_CAPACITY = PITCH_WINDOW_SAMPLES * 2;

const defaultAdapter = microphoneAdapter;

export function useMicPitch(captureId: string, enabled: boolean) {
  const [pitch, setPitch] = useState<{ captureId: string; hz: number | null }>({
    captureId,
    hz: null,
  });
  const ringRef = useRef<SampleRing | null>(null);
  const sampleRateRef = useRef(0);
  const lastFrameAtRef = useRef<number | null>(null);

  if (ringRef.current === null) {
    ringRef.current = new SampleRing(RING_CAPACITY);
  }

  useMicSamples(
    captureId,
    (frame) => {
      sampleRateRef.current = frame.sample_rate;
      ringRef.current?.push(frame.samples);
      lastFrameAtRef.current = performance.now();
    },
    enabled,
  );

  useEffect(() => {
    ringRef.current?.reset();
    sampleRateRef.current = 0;
    lastFrameAtRef.current = null;
    if (!enabled) {
      return undefined;
    }

    const detector = createMicPitchDetector();
    const window = new Float32Array(PITCH_WINDOW_SAMPLES);
    const updatePitch = (hz: number | null) => {
      setPitch((previous) =>
        previous.captureId === captureId && previous.hz === hz ? previous : { captureId, hz },
      );
    };

    const tick = () => {
      const ring = ringRef.current;
      const sr = sampleRateRef.current;
      const lastFrameAt = lastFrameAtRef.current;
      if (
        !ring ||
        sr === 0 ||
        lastFrameAt === null ||
        performance.now() - lastFrameAt > MAX_SAMPLE_AGE_MS
      ) {
        updatePitch(null);
        return;
      }
      if (!ring.readMostRecent(window)) {
        return;
      }
      const hz = detectPitchFromSamplesMic(detector, window, sr);
      updatePitch(hz);
    };

    const id = setInterval(tick, PITCH_TICK_MS);

    return () => clearInterval(id);
  }, [captureId, enabled]);

  const error: string | null = null;
  return {
    latestPitch: enabled && pitch.captureId === captureId ? pitch.hz : null,
    active: enabled,
    error,
  };
}

type MicCaptureInput = {
  captureId: string;
  deviceId: string | null;
  enabled: boolean;
  options: MicCaptureOptions;
};

export function useMicCapture(
  { captureId, deviceId, enabled, options }: MicCaptureInput,
  adapter: MicrophoneAdapter = defaultAdapter,
) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;

    const run = async () => {
      try {
        await adapter.startCapture(captureId, deviceId, options);

        if (cancelled) {
          return;
        }

        setActive(true);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          void adapter.stopCapture(captureId).catch(() => {});
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          setActive(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      void adapter.stopCapture(captureId).catch(() => {});
    };
  }, [adapter, captureId, deviceId, enabled, options]);

  return { active: enabled && active, error: enabled ? error : null };
}
