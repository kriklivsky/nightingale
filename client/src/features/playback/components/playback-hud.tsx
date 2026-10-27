import { PauseIcon } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useHudActivity } from '@/features/playback/hooks/use-hud-activity';
import {
  type PlaybackPlayerMicState,
  usePlaybackMicState,
  usePlaybackThemeState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import {
  computeLyricGapSeconds,
  findCurrentSegment,
  skipTarget,
} from '@/features/playback/utils/lyrics-gap';
import { Kbd } from '@/shared/components/ui/kbd';
import { useI18n } from '@/shared/i18n/use-i18n';
import { playerColorOption } from '@/shared/player-colors';
import { cn } from '@/shared/utils/cn';

import { PlaybackProgress } from './playback-progress';
import { isPixabayTheme } from './theme';

const TOUCH_QUERIES = ['(pointer: coarse)', '(any-pointer: coarse)'];

/** How long the AI/original-mix notes stay on screen after playback starts. */
const DISCLAIMER_VISIBLE_SEC = 8;

function formatPlaybackTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds) % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function hasTouchInput(): boolean {
  return (
    typeof window !== 'undefined' &&
    (navigator.maxTouchPoints > 0 ||
      TOUCH_QUERIES.some((query) => window.matchMedia(query).matches))
  );
}

function useHasTouchInput(): boolean {
  const [enabled, setEnabled] = useState(hasTouchInput);

  useEffect(() => {
    const media = TOUCH_QUERIES.map((query) => window.matchMedia(query));
    const sync = () => setEnabled(hasTouchInput());

    sync();
    media.forEach((item) => item.addEventListener('change', sync));
    return () => media.forEach((item) => item.removeEventListener('change', sync));
  }, []);

  return enabled;
}

type PlaybackHudPosition = 'top' | 'bottom';

type PlaybackDisclaimer = 'original-mix' | 'ai-timing' | 'ai-lyrics' | null;

function playbackDisclaimer(
  source: string,
  noStems: boolean,
  micActive: boolean,
): PlaybackDisclaimer {
  // No stems means we score against the original mix, so pitch scoring suffers.
  if (noStems && micActive) {
    return 'original-mix';
  }
  // USDX and provided LRC timings are authored, not AI-generated.
  if (source === 'usdx' || source === 'lrc') {
    return null;
  }
  return source === 'lyrics' ? 'ai-timing' : 'ai-lyrics';
}

function useDisclaimerText(disclaimer: PlaybackDisclaimer): string | null {
  const { t } = useI18n();
  if (disclaimer === 'original-mix') {
    return t('playback.disclaimer.originalMix');
  }
  if (disclaimer === 'ai-timing') {
    return t('playback.disclaimer.aiTiming');
  }
  if (disclaimer === 'ai-lyrics') {
    return t('playback.disclaimer.aiLyrics');
  }
  return null;
}

function TimedDisclaimer({ position }: { position: PlaybackHudPosition }) {
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const { guideAvailable } = usePlaybackTransportState();
  const { transcriptSource, segments } = usePlaybackTranscriptState();
  const { micUserEnabled } = usePlaybackMicState();
  const { t } = useI18n();
  const text = useDisclaimerText(
    playbackDisclaimer(transcriptSource, !guideAvailable, micUserEnabled),
  );
  const hasEstimatedWords = useMemo(
    () => segments.some((segment) => segment.words.some((word) => word.estimated === true)),
    [segments],
  );
  const [visible, setVisible] = useState(() => getCurrentTime() < DISCLAIMER_VISIBLE_SEC);

  useEffect(() => subscribe((time) => setVisible(time < DISCLAIMER_VISIBLE_SEC)), [subscribe]);

  if ((text === null && !hasEstimatedWords) || !visible) {
    return null;
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute left-1/2 z-20 flex max-w-[90%] -translate-x-1/2 flex-col items-center gap-0.5 rounded-md bg-black/50 px-3 py-1 text-center text-sm text-white/80',
        position === 'bottom' ? 'top-2' : 'bottom-6',
      )}
    >
      {text !== null && <p>{text}</p>}
      {hasEstimatedWords && (
        <p className="text-[rgb(255,200,100)]">{t('playback.disclaimer.estimatedWords')}</p>
      )}
    </div>
  );
}

const scoreTextClass = (score: number | null): string =>
  `text-lg tabular-nums md:text-2xl ${score !== null && score !== 0 ? 'text-white' : 'text-white/50'}`;

function MultiplayerScores({ players }: { players: PlaybackPlayerMicState[] }) {
  const { t } = useI18n();

  return (
    <div className="grid justify-items-end gap-0.5" aria-label={t('playback.playerScores')}>
      {players.map((player, index) => (
        <div
          key={player.id}
          className={`flex items-center justify-end gap-2 ${scoreTextClass(player.pitchScore)}`}
        >
          <span className="whitespace-nowrap">
            {player.profile ?? t('playback.guestNumber', { number: index + 1 })}:{' '}
            {player.pitchScore ?? '--'}
          </span>
          <span
            className={`size-2.5 rounded-full ${playerColorOption(player.color).className}`}
            aria-hidden="true"
          />
          <span className="sr-only">
            {player.micReady ? t('playback.micReady') : t('playback.micUnavailable')}
          </span>
        </div>
      ))}
    </div>
  );
}

function SkipButton({ position }: { position: PlaybackHudPosition }) {
  const { t } = useI18n();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const { segments, firstSegmentStart, lastSegmentEnd, introSkipLeadSec } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const bounds = useMemo(
    () => ({ segmentCount: segments.length, firstSegmentStart, lastSegmentEnd, introSkipLeadSec }),
    [firstSegmentStart, introSkipLeadSec, lastSegmentEnd, segments.length],
  );
  const [target, setTarget] = useState(() => skipTarget(getCurrentTime(), bounds));

  useEffect(() => subscribe((time) => setTarget(skipTarget(time, bounds))), [bounds, subscribe]);

  if (target === null) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={target === 'intro' ? handleSkipIntro : handleSkipOutro}
      className={cn(
        'pointer-events-auto flex w-fit items-center gap-2 rounded-md border-2 border-white/80 bg-black/40 px-3 py-1.5 text-base font-medium text-white transition-colors hover:bg-black/60',
        position === 'bottom' ? 'mb-2' : 'mt-2',
      )}
    >
      <Kbd className="h-6 bg-white/20 px-1.5 text-xs text-white">OK</Kbd>
      {target === 'intro' ? t('playback.skipIntro') : t('playback.skipOutro')}
    </button>
  );
}

function GapCaption() {
  const { t } = useI18n();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const { segments } = usePlaybackTranscriptState();
  const [seconds, setSeconds] = useState<number | null>(null);
  const hintRef = useRef(0);

  useEffect(() => {
    hintRef.current = 0;
    const update = (time: number) => {
      if (segments.length === 0) {
        setSeconds(null);
        return;
      }
      const index = findCurrentSegment(segments, time, hintRef.current);
      hintRef.current = index;
      setSeconds(computeLyricGapSeconds(segments, time, index));
    };
    update(getCurrentTime());
    return subscribe(update);
  }, [getCurrentTime, segments, subscribe]);

  return (
    <output aria-live="polite" className="text-sm font-medium text-white/80 md:text-base">
      {seconds === null ? '' : t('playback.nextLyricsIn', { seconds })}
    </output>
  );
}

function PlaybackClock() {
  const { duration } = usePlaybackTransportState();
  const { subscribe, getCurrentTime } = usePlaybackTransportActions();
  const timerRef = useRef<HTMLParagraphElement>(null);
  const lastSecondRef = useRef(-1);

  // Update the clock text without triggering React renders every frame.
  useEffect(() => {
    const update = (time: number) => {
      const second = Math.floor(time);
      if (second !== lastSecondRef.current && timerRef.current) {
        lastSecondRef.current = second;
        timerRef.current.textContent = `${formatPlaybackTime(time)} / ${formatPlaybackTime(duration)}`;
      }
    };
    lastSecondRef.current = -1;
    update(getCurrentTime());
    return subscribe(update);
  }, [duration, getCurrentTime, subscribe]);

  return (
    <p ref={timerRef} className="text-sm tabular-nums text-white/70 md:text-base">
      0:00 / {formatPlaybackTime(duration)}
    </p>
  );
}

function TouchPauseButton() {
  const { t } = useI18n();
  const { handlePause } = usePlaybackTransportActions();

  return (
    <button
      type="button"
      onClick={handlePause}
      aria-label={t('playback.pause')}
      className="pointer-events-auto flex size-11 items-center justify-center rounded-full border-2 border-white/70 bg-black/30 text-white active:bg-black/50"
    >
      <PauseIcon className="size-5" />
    </button>
  );
}

function FadeGroup({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'transition-opacity duration-500 motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {children}
    </div>
  );
}

function PixabayCredit({
  position,
  windowControls,
}: {
  position: PlaybackHudPosition;
  windowControls: boolean;
}) {
  const { t } = useI18n();
  const { theme } = usePlaybackThemeState();
  if (!isPixabayTheme(theme)) {
    return null;
  }
  let placement = position === 'bottom' ? 'top-2' : 'bottom-6';
  if (windowControls && position === 'bottom') {
    placement = 'top-12';
  }

  return (
    <p
      className={cn(
        'pointer-events-none absolute right-4 z-20 text-[0.6rem] text-white/30',
        placement,
      )}
    >
      {t('playback.pixabayCredit')}
    </p>
  );
}

function ScoreDisplay() {
  const { t } = useI18n();
  const { pitchScore, multiplayer, players } = usePlaybackMicState();

  if (multiplayer) {
    return <MultiplayerScores players={players} />;
  }
  return (
    <div className={scoreTextClass(pitchScore)}>
      {t('playback.score', { score: pitchScore ?? '--' })}
    </div>
  );
}

function hudPositionClass(position: PlaybackHudPosition): string {
  return position === 'bottom'
    ? 'bottom-[calc(2rem+env(safe-area-inset-bottom))] md:bottom-6'
    : 'top-[4.25rem] md:top-3';
}

type PlaybackHudProps = {
  title: string;
  artist: string;
  position?: PlaybackHudPosition;
  windowControls?: boolean;
};

function PlaybackHudImpl({
  title,
  artist,
  position = 'top',
  windowControls = false,
}: PlaybackHudProps) {
  const { paused } = usePlaybackTransportState();
  const hasTouch = useHasTouchInput();
  const active = useHudActivity(paused);
  const flowClass = position === 'bottom' ? 'flex-col-reverse' : 'flex-col';

  return (
    <>
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 z-20 flex gap-2 px-3 md:px-4',
          flowClass,
          hudPositionClass(position),
        )}
      >
        <div className={cn('flex justify-between gap-3', position === 'bottom' && 'items-end')}>
          <div className={cn('flex min-w-0 max-w-[58%] sm:max-w-[40%]', flowClass)}>
            <FadeGroup visible={active}>
              <h1 className="line-clamp-2 [overflow-wrap:anywhere] text-base leading-tight text-white md:text-[1.375rem]">
                {title}
              </h1>
              <p className="line-clamp-1 [overflow-wrap:anywhere] text-sm text-white/70 md:text-base">
                {artist}
              </p>
              <PlaybackClock />
            </FadeGroup>
            <GapCaption />
            <SkipButton position={position} />
          </div>

          <div
            className={cn(
              'flex min-w-0 items-end gap-2',
              flowClass,
              windowControls && position === 'top' && 'md:pt-9',
            )}
          >
            <ScoreDisplay />
            {hasTouch && <TouchPauseButton />}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-4">
        <PlaybackProgress emphasized={active} />
      </div>

      <PixabayCredit position={position} windowControls={windowControls} />

      <TimedDisclaimer position={position} />
    </>
  );
}

export const PlaybackHud = memo(PlaybackHudImpl);
