import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';

import { useMicSamples } from '@/features/microphone/hooks/use-mic-samples';
import {
  type MicReactiveEvent,
  REACTIVE_EMIT_PERIOD_MS,
  REACTIVE_FFT_SIZE,
  ReactiveAnalyzer,
} from '@/features/microphone/lib/reactive-analyzer';
import { SampleRing } from '@/features/microphone/lib/sample-ring';

const MIN_PITCH_HZ = 80;
const MAX_PITCH_HZ = 1000;
const RMS_GATE = 0.012;

const RING_CAPACITY = REACTIVE_FFT_SIZE * 2;

export type { MicReactiveEvent } from '@/features/microphone/lib/reactive-analyzer';
export type MicReactiveRef = MutableRefObject<MicReactiveEvent | null>;

type MicReactiveInput = {
  captureId: string;
  enabled: boolean;
};

type ReactiveSamples = {
  ringRef: MutableRefObject<SampleRing | null>;
  sampleRateRef: MutableRefObject<number>;
};

function useReactiveSamples({ captureId, enabled }: MicReactiveInput): ReactiveSamples {
  const ringRef = useRef<SampleRing | null>(null);
  const sampleRateRef = useRef(0);

  if (ringRef.current === null) {
    ringRef.current = new SampleRing(RING_CAPACITY);
  }

  useMicSamples(
    captureId,
    (frame) => {
      sampleRateRef.current = frame.sample_rate;
      ringRef.current?.push(frame.samples);
    },
    enabled,
  );

  useEffect(() => {
    if (!enabled) {
      ringRef.current?.reset();
      sampleRateRef.current = 0;
    }
  }, [enabled]);

  return useMemo(() => ({ ringRef, sampleRateRef }), []);
}

function addResampledSource(
  mixed: Float32Array,
  scratch: Float32Array,
  source: ReactiveSamples,
  targetRate: number,
): boolean {
  const sampleRate = source.sampleRateRef.current;
  const ring = source.ringRef.current;
  if (sampleRate === 0 || ring === null) {
    return false;
  }

  const ratio = sampleRate / targetRate;
  const sampleCount = Math.ceil((REACTIVE_FFT_SIZE - 1) * ratio) + 1;
  const samples = scratch.subarray(0, sampleCount);
  if (!ring.readMostRecent(samples)) {
    return false;
  }

  for (let index = 0; index < REACTIVE_FFT_SIZE; index++) {
    const position = sampleCount - 1 - (REACTIVE_FFT_SIZE - 1 - index) * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, sampleCount - 1);
    const blend = position - lower;
    mixed[index] += samples[lower] + (samples[upper] - samples[lower]) * blend;
  }
  return true;
}

export function useMicReactive([first, second, third, fourth]: readonly [
  MicReactiveInput,
  MicReactiveInput,
  MicReactiveInput,
  MicReactiveInput,
]): MicReactiveRef {
  const ref = useRef<MicReactiveEvent | null>(null);
  const firstSamples = useReactiveSamples(first);
  const secondSamples = useReactiveSamples(second);
  const thirdSamples = useReactiveSamples(third);
  const fourthSamples = useReactiveSamples(fourth);
  const firstEnabled = first.enabled;
  const secondEnabled = second.enabled;
  const thirdEnabled = third.enabled;
  const fourthEnabled = fourth.enabled;

  useEffect(() => {
    const sources = [
      [firstEnabled, firstSamples],
      [secondEnabled, secondSamples],
      [thirdEnabled, thirdSamples],
      [fourthEnabled, fourthSamples],
    ] as const;
    if (!sources.some(([enabled]) => enabled)) {
      ref.current = null;
      return undefined;
    }

    const analyzer = new ReactiveAnalyzer(MIN_PITCH_HZ, MAX_PITCH_HZ, RMS_GATE);
    const mixed = new Float32Array(REACTIVE_FFT_SIZE);
    const scratch = new Float32Array(REACTIVE_FFT_SIZE);

    const tick = () => {
      let targetRate = 0;
      for (const [enabled, source] of sources) {
        if (enabled) {
          targetRate = Math.max(targetRate, source.sampleRateRef.current);
        }
      }
      if (targetRate === 0) {
        return;
      }

      mixed.fill(0);
      let mixedSources = 0;
      for (const [enabled, source] of sources) {
        if (enabled && addResampledSource(mixed, scratch, source, targetRate)) {
          mixedSources++;
        }
      }
      if (mixedSources === 0) {
        return;
      }
      for (let index = 0; index < mixed.length; index++) {
        mixed[index] = Math.max(-1, Math.min(1, mixed[index]));
      }
      ref.current = analyzer.analyze(mixed, targetRate);
    };

    const id = setInterval(tick, REACTIVE_EMIT_PERIOD_MS);

    return () => {
      clearInterval(id);
      ref.current = null;
    };
  }, [
    firstEnabled,
    firstSamples,
    fourthEnabled,
    fourthSamples,
    secondEnabled,
    secondSamples,
    thirdEnabled,
    thirdSamples,
  ]);

  return ref;
}
