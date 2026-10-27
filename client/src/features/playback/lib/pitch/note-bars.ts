import type { ReferenceContour } from './state';

/** A held reference note: `note` is a MIDI note number, times are seconds. */
export type NoteBar = {
  start: number;
  end: number;
  note: number;
};

/** Unvoiced frames tolerated inside one held note (vibrato, consonants). */
const MAX_GAP_FRAMES = 2;
/** Stay on the current note until the melody moves this far (semitones). */
const NOTE_HYSTERESIS = 0.75;
const MIN_NOTE_SEC = 0.08;

/**
 * Display-only quantization of the detected reference melody into held notes.
 * Scoring still compares raw pitch; this only drives the note lane.
 */
export function contourToNoteBars({ hopSec, semitones }: ReferenceContour): NoteBar[] {
  const bars: NoteBar[] = [];
  const maxGapSec = hopSec * (MAX_GAP_FRAMES + 0.5);
  let current: NoteBar | null = null;

  for (let frame = 0; frame < semitones.length; frame++) {
    const value = semitones[frame];
    if (Number.isNaN(value)) {
      continue;
    }
    const time = frame * hopSec;
    if (
      current !== null &&
      time - current.end <= maxGapSec &&
      Math.abs(value - current.note) < NOTE_HYSTERESIS
    ) {
      current.end = time + hopSec;
      continue;
    }
    if (current !== null && current.end - current.start >= MIN_NOTE_SEC) {
      bars.push(current);
    }
    current = { start: time, end: time + hopSec, note: Math.round(value) };
  }
  if (current !== null && current.end - current.start >= MIN_NOTE_SEC) {
    bars.push(current);
  }

  return bars;
}

/** Index of the first bar that ends at or after `time` (bars sorted by start). */
export function firstBarEndingAfter(bars: readonly NoteBar[], time: number): number {
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bars[middle].end < time) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export function noteAt(bars: readonly NoteBar[], time: number): number | null {
  const bar = bars.at(firstBarEndingAfter(bars, time));
  return bar !== undefined && bar.start <= time ? bar.note : null;
}
