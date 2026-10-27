import { memo, useEffect, useRef } from 'react';

import {
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

const percent = (value: number, total: number): string =>
  `${Math.max(0, Math.min(100, (value / total) * 100))}%`;

/** Song position with the sung passages marked, so instrumental gaps are visible ahead of time. */
function PlaybackProgressImpl({ emphasized }: { emphasized: boolean }) {
  const { t } = useI18n();
  const { duration } = usePlaybackTransportState();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const { segments } = usePlaybackTranscriptState();
  const fillRef = useRef<HTMLSpanElement>(null);
  const meterRef = useRef<HTMLMeterElement>(null);
  const lastSecondRef = useRef(-1);

  useEffect(() => {
    const update = (time: number) => {
      if (duration <= 0) {
        return;
      }
      if (fillRef.current) {
        fillRef.current.style.width = percent(time, duration);
      }
      const second = Math.floor(time);
      if (meterRef.current && second !== lastSecondRef.current) {
        lastSecondRef.current = second;
        meterRef.current.value = second;
      }
    };
    update(getCurrentTime());
    return subscribe(update);
  }, [duration, getCurrentTime, subscribe]);

  if (duration <= 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-white/15 transition-opacity duration-500 motion-reduce:transition-none',
        emphasized ? 'opacity-100' : 'opacity-50',
      )}
    >
      <meter
        ref={meterRef}
        className="sr-only"
        aria-label={t('playback.progress')}
        min={0}
        max={Math.floor(duration)}
        defaultValue={0}
      />
      {segments.map((segment) => (
        <span
          key={`${segment.start}-${segment.end}`}
          aria-hidden="true"
          className="absolute inset-y-0 bg-white/25"
          style={{
            left: percent(segment.start, duration),
            width: percent(segment.end - segment.start, duration),
          }}
        />
      ))}
      <span
        ref={fillRef}
        aria-hidden="true"
        className="absolute inset-y-0 left-0 rounded-full bg-primary"
        style={{ width: '0%' }}
      />
    </div>
  );
}

export const PlaybackProgress = memo(PlaybackProgressImpl);
