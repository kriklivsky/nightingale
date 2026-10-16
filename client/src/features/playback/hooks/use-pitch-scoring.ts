import { useCallback, useEffect, useRef, useState } from 'react';

import type { TimeSubscriber } from '@/features/playback/hooks/use-audio-player';
import {
  DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  MAX_MIC_LATENCY_COMPENSATION_SEC,
  MIN_MIC_LATENCY_COMPENSATION_SEC,
  PITCH_WINDOW_SAMPLES,
} from '@/features/playback/lib/pitch/constants';
import {
  createPitchDetector,
  detectPitchFromSamplesRef,
} from '@/features/playback/lib/pitch/detect';
import { PitchReportBuffer } from '@/features/playback/lib/pitch/report';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import {
  PitchScoring,
  PitchStateBuffer,
  pitchSimilarity,
  sampleVocalsWindow,
} from '@/features/playback/lib/pitch/state';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import type { Segment } from '@/types/Transcript';

export type PitchScoringSource = {
  isReady: boolean;
  duration: number;
  singableDuration: number;
  getReferenceBuffer: () => AudioBuffer | null;
  subscribe: (fn: TimeSubscriber) => () => void;
};

export function usePitchScoring(
  { isReady, duration, singableDuration, getReferenceBuffer, subscribe }: PitchScoringSource,
  micPitch: number | null,
  latencyCompensationSec = DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
) {
  const [refDetector] = useState(createPitchDetector);
  const [scratch] = useState(() => new Float32Array(PITCH_WINDOW_SAMPLES));
  const bufferRef = useRef(new PitchStateBuffer());
  const scoringRef = useRef(new PitchScoring(1));
  const reportRef = useRef(new PitchReportBuffer());
  const micPitchRef = useLatestRef(micPitch);
  const latencyRef = useLatestRef(
    Math.min(
      MAX_MIC_LATENCY_COMPENSATION_SEC,
      Math.max(MIN_MIC_LATENCY_COMPENSATION_SEC, latencyCompensationSec),
    ),
  );
  const [series, setSeries] = useState<PitchSeries>({
    refPitches: [],
    userPitches: [],
    similarities: [],
  });
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!isReady || duration <= 0) {
      return;
    }
    bufferRef.current.reset();
    reportRef.current.reset();

    scoringRef.current = new PitchScoring(singableDuration);

    setSeries(bufferRef.current.snapshot());
    setScore(0);
  }, [isReady, duration, singableDuration]);

  useEffect(() => {
    if (!isReady) {
      return undefined;
    }

    const run = (t: number) => {
      if (t <= 0) {
        return;
      }

      const reference = getReferenceBuffer();
      const mp = micPitchRef.current;
      const referenceTimeSec = Math.max(0, t - latencyRef.current);

      if (!reference || !sampleVocalsWindow(reference, t, scratch, latencyRef.current)) {
        bufferRef.current.tryPush(null, mp, 0, t);
        reportRef.current.record(referenceTimeSec, null, mp);
      } else {
        const refHz = detectPitchFromSamplesRef(refDetector, scratch, reference.sampleRate);
        const sim = refHz !== null && mp !== null ? pitchSimilarity(refHz, mp) : 0;
        bufferRef.current.tryPush(refHz, mp, sim, t);
        scoringRef.current.accumulate(t, refHz, mp, sim);
        reportRef.current.record(referenceTimeSec, refHz, mp);
      }

      setSeries(bufferRef.current.snapshot());
      setScore(scoringRef.current.score());
    };

    return subscribe(run);
  }, [getReferenceBuffer, isReady, latencyRef, micPitchRef, refDetector, scratch, subscribe]);

  const getPitchReport = useCallback(
    (segments: readonly Segment[]) => reportRef.current.snapshot(segments),
    [],
  );

  return { series, score, getPitchReport };
}
