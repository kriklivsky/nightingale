import type { Segment } from '@/types/Transcript';

// Small timing leads keep lyric transitions visually in sync with the audio.
export const LYRICS_LEAD = 0.15;
export const WORD_HIGHLIGHT_LEAD = 0.25;
export const SEGMENT_LINGER = 0.5;
export const GAP_THRESHOLD_SEC = 3.5;
export const BUBBLE_COUNTDOWN_SEC = 3.0;

/** Finds the displayed segment, using `hint` to skip already-passed entries. */
export function findCurrentSegment(segments: Segment[], time: number, hint: number): number {
  const start = hint < segments.length && time >= segments[hint].start - LYRICS_LEAD ? hint : 0;

  for (let i = start; i < segments.length; i++) {
    if (time >= segments[i].end + SEGMENT_LINGER) {
      const next = i + 1;

      // Keep a finished line through short pauses until the next line's lead-in.
      if (
        next < segments.length &&
        segments[next].start - segments[i].end < GAP_THRESHOLD_SEC &&
        time < segments[next].start - LYRICS_LEAD
      ) {
        return i;
      }

      continue;
    }

    const next = i + 1;
    if (next < segments.length && time >= segments[next].start - LYRICS_LEAD) {
      return next;
    }

    return i;
  }

  return Math.max(0, segments.length - 1);
}

/** Whole seconds until the next lyric line during a long instrumental gap. */
export function computeLyricGapSeconds(
  segments: Segment[],
  time: number,
  segIdx: number,
): number | null {
  const seg = segments.at(segIdx);
  if (!seg) {
    return null;
  }

  // Intro gaps do not get a HUD caption.
  if (segIdx === 0) {
    return null;
  }

  const gapBefore = seg.start - segments[segIdx - 1].end;
  const timeUntil = seg.start - time;
  const inGap = gapBefore >= GAP_THRESHOLD_SEC && timeUntil > 0;
  if (!inGap) {
    return null;
  }

  return Math.ceil(timeUntil);
}

export type SkipBounds = {
  segmentCount: number;
  firstSegmentStart: number;
  lastSegmentEnd: number;
  introSkipLeadSec: number;
};

/** Which skip the HUD offers at `time`, if any. Songs without lyrics offer none. */
export function skipTarget(time: number, bounds: SkipBounds): 'intro' | 'outro' | null {
  if (bounds.segmentCount === 0) {
    return null;
  }
  if (time < bounds.firstSegmentStart - bounds.introSkipLeadSec) {
    return 'intro';
  }
  if (time > bounds.lastSegmentEnd + 1) {
    return 'outro';
  }
  return null;
}
