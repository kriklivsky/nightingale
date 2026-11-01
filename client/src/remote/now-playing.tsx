import {
  FastForwardIcon,
  HeadphonesIcon,
  ImageIcon,
  MicIcon,
  MicOffIcon,
  PauseIcon,
  PlayIcon,
  RewindIcon,
  RotateCcwIcon,
  SkipForwardIcon,
  SquareIcon,
} from 'lucide-react';

import type { RemoteCommand } from '@/bridge/remote-control';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';
import { Progress } from '@/shared/components/ui/progress';
import { useI18n } from '@/shared/i18n/use-i18n';
import { formatSeconds } from '@/shared/utils/format-duration';

import { sendCommand, type PlayingStatus } from './api';
import { useRemoteAction } from './use-remote';
import { VolumeSlider } from './volume-slider';

type NowPlayingProps = {
  tv: PlayingStatus;
  monitorGain: number;
};

type ControlsProps = {
  tv: PlayingStatus;
  send: (command: RemoteCommand) => void;
};

const ICON_BUTTON = 'size-12';

function SongProgress({ tv }: { tv: PlayingStatus }) {
  const { t } = useI18n();
  const progress = tv.durationSec > 0 ? (tv.positionSec / tv.durationSec) * 100 : 0;

  return (
    <div className="flex flex-col gap-1">
      <Progress value={progress} aria-label={t('remote.nowPlaying')} />
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{formatSeconds(tv.positionSec)}</span>
        <span>{formatSeconds(tv.durationSec)}</span>
      </div>
    </div>
  );
}

function TransportButtons({ tv, send }: ControlsProps) {
  const { t } = useI18n();
  const active = tv.ready && !tv.resultOpen;

  return (
    <div className="flex items-center justify-between">
      <Button
        variant="ghost"
        size="icon-lg"
        className={ICON_BUTTON}
        disabled={!active}
        onClick={() => send({ type: 'restart' })}
        aria-label={t('playback.restart')}
      >
        <RotateCcwIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        className={ICON_BUTTON}
        disabled={!active}
        onClick={() => send({ type: 'seek', deltaSec: -10 })}
        aria-label={t('remote.back10')}
      >
        <RewindIcon />
      </Button>
      <Button
        size="icon-lg"
        className="size-14"
        disabled={!active}
        onClick={() => send({ type: tv.paused ? 'resume' : 'pause' })}
        aria-label={tv.paused ? t('playback.continue') : t('playback.pause')}
      >
        {tv.paused ? <PlayIcon /> : <PauseIcon />}
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        className={ICON_BUTTON}
        disabled={!active}
        onClick={() => send({ type: 'seek', deltaSec: 10 })}
        aria-label={t('remote.forward10')}
      >
        <FastForwardIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        className={ICON_BUTTON}
        disabled={!tv.canSkip}
        onClick={() => send({ type: 'next' })}
        aria-label={t('remote.next')}
      >
        <SkipForwardIcon />
      </Button>
    </div>
  );
}

function MicButtons({ tv, send }: ControlsProps) {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-3 gap-2">
      <Button
        variant={tv.micEnabled ? 'default' : 'outline'}
        className="h-11 text-sm"
        aria-pressed={tv.micEnabled}
        onClick={() => send({ type: 'toggleMic' })}
      >
        {tv.micEnabled ? <MicIcon /> : <MicOffIcon />} {t('playback.microphone')}
      </Button>
      <Button
        variant={tv.monitorEnabled ? 'default' : 'outline'}
        className="h-11 text-sm"
        aria-pressed={tv.monitorEnabled}
        onClick={() => send({ type: 'toggleMonitor' })}
      >
        <HeadphonesIcon /> {t('playback.monitoring')}
      </Button>
      <Button
        variant="outline"
        className="h-11 text-sm"
        onClick={() => send({ type: 'background' })}
      >
        <ImageIcon /> {t('playback.background')}
      </Button>
    </div>
  );
}

function StopButton({ tv, send }: ControlsProps) {
  const { t } = useI18n();

  if (tv.resultOpen) {
    return (
      <Button variant="outline" className="h-11 text-sm" onClick={() => send({ type: 'stop' })}>
        {t('playback.exitToMenu')}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="h-11 text-sm text-destructive">
          <SquareIcon /> {t('remote.stop')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('remote.stopTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('playback.exitLosesProgress')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('remote.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => send({ type: 'stop' })}>
            {t('remote.stop')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function sceneMessage(tv: PlayingStatus, t: ReturnType<typeof useI18n>['t']): string | null {
  if (tv.resultOpen) {
    return t('remote.songFinished');
  }
  return tv.ready ? null : t('remote.loadingSong');
}

export function NowPlaying({ tv, monitorGain }: NowPlayingProps) {
  const { t } = useI18n();
  const command = useRemoteAction(sendCommand);
  const send = (input: RemoteCommand) => command.mutate(input);
  const message = sceneMessage(tv, t);

  return (
    <section
      className="mb-4 flex flex-col gap-4 rounded-lg border p-4"
      aria-label={t('remote.nowPlaying')}
    >
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{t('remote.nowPlaying')}</p>
        <p className="truncate text-base font-semibold">{tv.title}</p>
        <p className="truncate text-sm text-muted-foreground">{tv.artist || '—'}</p>
      </div>
      {message === null ? <SongProgress tv={tv} /> : <output className="text-sm">{message}</output>}
      <TransportButtons tv={tv} send={send} />
      <MicButtons tv={tv} send={send} />
      <VolumeSlider
        label={t('playback.volume')}
        value={tv.outputVolume}
        onCommit={(value) => send({ type: 'outputVolume', value })}
      />
      {tv.guideAvailable ? (
        <VolumeSlider
          label={t('playback.guideVocals')}
          value={tv.guideVolume}
          onCommit={(value) => send({ type: 'guideVolume', value })}
        />
      ) : null}
      <VolumeSlider
        label={t('settings.mic.monitorGain')}
        value={monitorGain}
        max={2}
        onCommit={(value) => send({ type: 'monitorGain', value })}
      />
      <StopButton tv={tv} send={send} />
    </section>
  );
}
