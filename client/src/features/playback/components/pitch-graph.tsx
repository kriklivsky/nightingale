import { useEffect, useState, type CSSProperties } from 'react';

import { clampPlaybackScale } from '@/features/playback/lib/display-scale';
import { pitchDeviation } from '@/features/playback/lib/pitch/report';
import type { PitchSeries } from '@/features/playback/lib/pitch/state';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

type PitchGraphProps = {
  series: PitchSeries;
  micReady: boolean;
  micUserEnabled: boolean;
  paused: boolean;
  position?: 'top' | 'bottom';
  scale?: number | null;
};

type MeterStyle = CSSProperties & { '--pitch-scale': number };

function recentDeviation(series: PitchSeries): number | null {
  const deviations: number[] = [];
  const start = Math.max(0, series.refPitches.length - 25);
  for (let i = start; i < series.refPitches.length; i++) {
    const reference = series.refPitches[i];
    const voice = series.userPitches[i];
    if (typeof reference === 'number' && typeof voice === 'number') {
      deviations.push(pitchDeviation(reference, voice));
    }
  }
  if (deviations.length < 4) {
    return null;
  }

  deviations.sort((a, b) => a - b);
  return deviations[Math.floor(deviations.length / 2)];
}

function useCalmPitch(series: PitchSeries, active: boolean): number | null {
  const seriesRef = useLatestRef(series);
  const [deviation, setDeviation] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let lastDetectedAt = 0;
    const timer = window.setInterval(() => {
      const next = recentDeviation(seriesRef.current);
      if (next !== null) {
        lastDetectedAt = performance.now();
        setDeviation((previous) => (previous === null ? next : previous * 0.7 + next * 0.3));
      } else if (performance.now() - lastDetectedAt > 1000) {
        setDeviation(null);
      }
    }, 200);

    return () => window.clearInterval(timer);
  }, [active, seriesRef]);

  return active ? deviation : null;
}

export function PitchGraph({
  series,
  micReady,
  micUserEnabled,
  paused,
  position = 'top',
  scale = 1,
}: PitchGraphProps) {
  const deviation = useCalmPitch(series, micReady && !paused);
  const positionClass = position === 'bottom' ? 'bottom-32 sm:bottom-3' : 'top-36 sm:top-3';
  const label = micUserEnabled ? 'Pitch · details after the song' : 'Microphone off';
  const meterScale = clampPlaybackScale(scale);
  const style: MeterStyle = {
    '--pitch-scale': meterScale,
    scale: meterScale,
    transformOrigin: `center ${position}`,
  };

  return (
    <figure
      aria-label="Pitch position relative to the melody"
      className={`pointer-events-none absolute left-1/2 z-20 w-72 max-w-[calc(90%/var(--pitch-scale))] -translate-x-1/2 rounded-xl border border-white/20 bg-black/70 p-3 sm:max-w-[calc(40%/var(--pitch-scale))] ${positionClass}`}
      style={style}
    >
      <figcaption className="text-center text-xs text-white/70">{label}</figcaption>
      <div className="relative mt-3 h-2 rounded-full bg-white/15" aria-hidden="true">
        <span className="absolute inset-y-0 left-5/12 w-1/6 bg-white/35" />
        <span className="absolute -inset-y-1 left-1/2 border-l border-white/70" />
        <span
          className="absolute -inset-y-1 w-1 -translate-x-1/2 rounded-full bg-white transition-[left,opacity] duration-700 ease-out motion-reduce:transition-none"
          style={{
            left: `${50 + (Math.max(-3, Math.min(3, deviation ?? 0)) / 3) * 50}%`,
            opacity: deviation === null ? 0 : 1,
          }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-white/70">
        <span>Low</span>
        <span>Target</span>
        <span>High</span>
      </div>
    </figure>
  );
}
