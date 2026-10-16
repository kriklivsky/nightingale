import type { Segment } from '@/types/Transcript';

import { freqToSemitone, snapToRefOctave } from './state';

export const ON_PITCH_SEMITONES = 0.5;
const SAMPLE_INTERVAL_SEC = 0.1;

type PitchSample = { timeSec: number; deviation: number | null; hasReference: boolean };

export type PitchTotals = {
  reference: number;
  voiced: number;
  onPitch: number;
  low: number;
  high: number;
  absoluteDeviation: number;
};

export type PitchPhrase = {
  start: number;
  end: number;
  text: string;
  totals: PitchTotals;
};

export type PitchReport = { totals: PitchTotals; phrases: PitchPhrase[] };

function emptyTotals(): PitchTotals {
  return { reference: 0, voiced: 0, onPitch: 0, low: 0, high: 0, absoluteDeviation: 0 };
}

export function pitchDeviation(referenceHz: number, voiceHz: number): number {
  const reference = freqToSemitone(referenceHz);
  return snapToRefOctave(reference, freqToSemitone(voiceHz)) - reference;
}

function addSample(totals: PitchTotals, sample: PitchSample): void {
  if (!sample.hasReference) {
    return;
  }
  totals.reference++;
  if (sample.deviation === null) {
    return;
  }

  totals.voiced++;
  totals.absoluteDeviation += Math.abs(sample.deviation);
  if (Math.abs(sample.deviation) <= ON_PITCH_SEMITONES) {
    totals.onPitch++;
  } else if (sample.deviation < 0) {
    totals.low++;
  } else {
    totals.high++;
  }
}

function summarize(samples: readonly PitchSample[], segments: readonly Segment[]): PitchReport {
  const totals = emptyTotals();
  const phrases = segments.map(({ start, end, text }) => ({
    start,
    end,
    text,
    totals: emptyTotals(),
  }));

  for (const sample of samples) {
    addSample(totals, sample);
    const phrase = phrases.find(
      ({ start, end }) => sample.timeSec >= start && sample.timeSec < end,
    );
    if (phrase) {
      addSample(phrase.totals, sample);
    }
  }

  return { totals, phrases: phrases.filter((phrase) => phrase.totals.reference > 0) };
}

export class PitchReportBuffer {
  private readonly samples = new Map<number, PitchSample>();
  private lastBucket: number | null = null;

  record(referenceTimeSec: number, referenceHz: number | null, voiceHz: number | null): void {
    const bucket = Math.floor(referenceTimeSec / SAMPLE_INTERVAL_SEC);
    if (bucket === this.lastBucket) {
      return;
    }
    this.lastBucket = bucket;

    let deviation: number | null = null;
    if (referenceHz !== null && voiceHz !== null) {
      deviation = pitchDeviation(referenceHz, voiceHz);
    }

    this.samples.set(bucket, {
      timeSec: referenceTimeSec,
      hasReference: referenceHz !== null,
      deviation,
    });
  }

  snapshot(segments: readonly Segment[]): PitchReport {
    return summarize(
      [...this.samples.values()].toSorted((a, b) => a.timeSec - b.timeSec),
      segments,
    );
  }

  reset(): void {
    this.samples.clear();
    this.lastBucket = null;
  }
}
