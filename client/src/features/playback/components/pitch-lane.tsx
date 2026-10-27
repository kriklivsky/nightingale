import { useEffect, useMemo, useRef, type CSSProperties } from 'react';

import { clampPlaybackScale } from '@/features/playback/lib/display-scale';
import {
  contourToNoteBars,
  firstBarEndingAfter,
  noteAt,
  type NoteBar,
} from '@/features/playback/lib/pitch/note-bars';
import { ON_PITCH_SEMITONES } from '@/features/playback/lib/pitch/report';
import {
  freqToSemitone,
  snapToRefOctave,
  type PitchSeries,
  type ReferenceContour,
} from '@/features/playback/lib/pitch/state';
import { usePlaybackTransportActions } from '@/features/playback/providers';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

/** Seconds of melody shown before and after the "now" line. */
const PAST_SEC = 2;
const FUTURE_SEC = 4;
const MIN_SPAN_SEMITONES = 14;
const RANGE_PADDING_SEMITONES = 2;
const RANGE_EASING = 0.08;

const COLORS = {
  note: 'rgba(255,255,255,0.28)',
  activeNote: 'rgba(255,255,255,0.7)',
  nowLine: 'rgba(255,255,255,0.8)',
  onPitch: '#34d399',
  below: '#60a5fa',
  above: '#fbbf24',
} as const;

type LaneStyle = CSSProperties & { '--pitch-scale': number };

type PitchLaneProps = {
  contour: ReferenceContour;
  series: PitchSeries;
  latencySec: number;
  micUserEnabled: boolean;
  paused: boolean;
  position?: 'top' | 'bottom';
  scale?: number | null;
};

type Range = { center: number; span: number };

function targetRange(bars: readonly NoteBar[], from: number, to: number, previous: Range): Range {
  let low = Infinity;
  let high = -Infinity;
  for (let index = firstBarEndingAfter(bars, from); index < bars.length; index++) {
    const bar = bars[index];
    if (bar.start > to) {
      break;
    }
    low = Math.min(low, bar.note);
    high = Math.max(high, bar.note);
  }
  if (!Number.isFinite(low)) {
    return previous;
  }
  return {
    center: (low + high) / 2,
    span: Math.max(MIN_SPAN_SEMITONES, high - low + RANGE_PADDING_SEMITONES * 2),
  };
}

function userColor(deviation: number): string {
  // Bars are rounded to whole semitones, so allow for that quantization.
  if (Math.abs(deviation) <= ON_PITCH_SEMITONES + 0.5) {
    return COLORS.onPitch;
  }
  return deviation < 0 ? COLORS.below : COLORS.above;
}

type Rect = { left: number; top: number; width: number; height: number };

function pillPath(context: CanvasRenderingContext2D, { left, top, width, height }: Rect) {
  const radius = Math.min(height / 2, width / 2);
  context.beginPath();
  context.moveTo(left + radius, top);
  context.arcTo(left + width, top, left + width, top + height, radius);
  context.arcTo(left + width, top + height, left, top + height, radius);
  context.arcTo(left, top + height, left, top, radius);
  context.arcTo(left, top, left + width, top, radius);
  context.closePath();
}

type LaneGeometry = {
  context: CanvasRenderingContext2D;
  height: number;
  now: number;
  from: number;
  to: number;
  barHeight: number;
  range: Range;
  x: (time: number) => number;
  y: (note: number) => number;
};

function laneGeometry(
  context: CanvasRenderingContext2D,
  size: { width: number; height: number },
  now: number,
  range: Range,
): LaneGeometry {
  const from = now - PAST_SEC;
  const to = now + FUTURE_SEC;
  const rowHeight = size.height / range.span;
  return {
    context,
    height: size.height,
    now,
    from,
    to,
    range,
    barHeight: Math.max(4, rowHeight * 0.8),
    x: (time) => ((time - from) / (to - from)) * size.width,
    y: (note) => size.height / 2 - (note - range.center) * rowHeight,
  };
}

function drawBars(lane: LaneGeometry, bars: readonly NoteBar[]) {
  const { context, x, y, barHeight } = lane;
  for (let index = firstBarEndingAfter(bars, lane.from); index < bars.length; index++) {
    const bar = bars[index];
    if (bar.start > lane.to) {
      break;
    }
    context.fillStyle =
      bar.start <= lane.now && bar.end >= lane.now ? COLORS.activeNote : COLORS.note;
    pillPath(context, {
      left: x(bar.start),
      top: y(bar.note) - barHeight / 2,
      width: Math.max(2, x(bar.end) - x(bar.start)),
      height: barHeight,
    });
    context.fill();
  }
}

function drawVoice(
  lane: LaneGeometry,
  bars: readonly NoteBar[],
  series: PitchSeries,
  latencySec: number,
) {
  const { context, x, y } = lane;
  const dot = Math.max(3, lane.barHeight / 2.5);
  series.userPitches.forEach((hz, index) => {
    const time = series.times[index] - latencySec;
    if (hz === null || time < lane.from || time > lane.now) {
      return;
    }
    const reference = noteAt(bars, time);
    const voice = snapToRefOctave(reference ?? lane.range.center, freqToSemitone(hz));
    context.fillStyle = reference === null ? COLORS.nowLine : userColor(voice - reference);
    context.beginPath();
    context.arc(x(time), y(voice), dot, 0, Math.PI * 2);
    context.fill();
  });
}

/**
 * Note lane: upcoming and past reference notes scroll toward a fixed "now"
 * line while the singer's detected pitch is drawn on top. Octaves are folded
 * onto the reference, matching octave-agnostic scoring.
 */
export function PitchLane({
  contour,
  series,
  latencySec,
  micUserEnabled,
  paused,
  position = 'top',
  scale = 1,
}: PitchLaneProps) {
  const { t } = useI18n();
  const { getCurrentTime } = usePlaybackTransportActions();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bars = useMemo(() => contourToNoteBars(contour), [contour]);
  const seriesRef = useLatestRef(series);
  const latencyRef = useLatestRef(latencySec);
  const rangeRef = useRef<Range>({ center: 60, span: MIN_SPAN_SEMITONES });
  const laneScale = clampPlaybackScale(scale);
  const style: LaneStyle = {
    '--pitch-scale': laneScale,
    scale: laneScale,
    transformOrigin: `center ${position}`,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return undefined;
    }

    let frame = 0;
    const render = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const now = getCurrentTime() - latencyRef.current;
      const target = targetRange(bars, now - PAST_SEC, now + FUTURE_SEC, rangeRef.current);
      const previous = rangeRef.current;
      rangeRef.current = {
        center: previous.center + (target.center - previous.center) * RANGE_EASING,
        span: previous.span + (target.span - previous.span) * RANGE_EASING,
      };
      const lane = laneGeometry(context, { width, height }, now, rangeRef.current);
      context.clearRect(0, 0, width, height);
      drawBars(lane, bars);
      drawVoice(lane, bars, seriesRef.current, latencyRef.current);
      context.fillStyle = COLORS.nowLine;
      context.fillRect(lane.x(now) - 1, 0, 2, height);
      if (!paused) {
        frame = requestAnimationFrame(render);
      }
    };

    render();
    return () => cancelAnimationFrame(frame);
  }, [bars, getCurrentTime, latencyRef, paused, seriesRef]);

  return (
    <figure
      aria-label={t('playback.pitchLane')}
      className={cn(
        'pointer-events-none absolute left-1/2 z-20 w-[min(40rem,90vw)] max-w-[calc(90vw/var(--pitch-scale))] -translate-x-1/2 overflow-hidden rounded-xl border border-white/15 bg-black/55',
        position === 'bottom' ? 'bottom-32 sm:bottom-8' : 'top-36 sm:top-3',
      )}
      style={style}
    >
      <canvas ref={canvasRef} className="block h-24 w-full sm:h-28" aria-hidden="true" />
      {!micUserEnabled && (
        <figcaption className="absolute top-1 right-2 text-xs text-white/70">
          {t('playback.microphoneOff')}
        </figcaption>
      )}
    </figure>
  );
}
