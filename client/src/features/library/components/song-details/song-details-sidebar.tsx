import { useQueryClient } from '@tanstack/react-query';
import { ListPlusIcon, PlayIcon, UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { useAddPlaybackQueueEntry } from '@/features/playback-queue/use-playback-queue';
import { MultiplayerSetupDialog } from '@/features/playback/components/dialogs/multiplayer-setup';
import { usePlaybackLauncher } from '@/features/playback/hooks/use-playback-launcher';
import { usePreparePlaybackMutation } from '@/features/playback/mutations/use-prepare-playback-mutation';
import { useBestScoresBySongForActiveProfile } from '@/features/profiles/hooks/use-best-scores-by-song';
import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import { Spinner } from '@/shared/components/ui/spinner';
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import { SONGS } from '@/shared/query-keys';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

import { getSongStatusInfo } from '../song/song-status';
import { ActionsSection } from './actions-section';
import { KeyTempoSection } from './key-tempo-section';
import { SongDetailsHeader } from './song-details-header';
import { useSongDetailsNav } from './use-song-details-nav';

type SongDetailsSidebarProps = {
  song: Song;
  queueStatus?: QueuedStatus;
  onClose: () => void;
};

type AddToQueueButtonProps = {
  song: Song;
  tempo: number;
  keyOffset: number;
  ready: boolean;
  preparing: boolean;
};

function AddToQueueButton({ song, tempo, keyOffset, ready, preparing }: AddToQueueButtonProps) {
  const { t } = useI18n();
  const { mutate: addToQueue, isLoading } = useAddPlaybackQueueEntry();

  return (
    <Button
      variant="outline"
      size="lg"
      className="h-11"
      disabled={!ready || preparing || isLoading}
      onClick={() => addToQueue({ song, tempo, keyOffset })}
      aria-label={t('songDetails.addToQueueLabel', { title: song.title })}
    >
      <ListPlusIcon />
      {t('songDetails.addToQueue')}
    </Button>
  );
}

function analysisFailureMessage(t: Translate, failure: string): string {
  if (failure.startsWith('No synchronized lyrics found')) {
    return t('songDetails.failure.noLyrics');
  }
  if (failure.startsWith('Song title, artist, and duration')) {
    return t('songDetails.failure.metadata');
  }
  if (failure.startsWith('LRCLIB is unavailable') || failure.startsWith('LRCLIB rate limit')) {
    return t('songDetails.failure.lrclibUnavailable');
  }
  return t('songDetails.failure.generic');
}

function AnalysisFailure({ queueStatus }: { queueStatus?: QueuedStatus }) {
  const { t } = useI18n();
  if (typeof queueStatus !== 'object' || !('Failed' in queueStatus)) {
    return null;
  }
  const message = analysisFailureMessage(t, queueStatus.Failed);

  return (
    <p
      role="alert"
      className="mx-4 mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

const hasPendingKey = (song: Song): boolean =>
  song.is_analyzed && song.transcript_source === 'Lrc' && song.no_stems && song.key === null;

export const SongDetailsSidebar = ({ song, queueStatus, onClose }: SongDetailsSidebarProps) => {
  const { t } = useI18n();
  const [multiplayerOpen, setMultiplayerOpen] = useState(false);
  const queryClient = useQueryClient();
  const bestScores = useBestScoresBySongForActiveProfile();
  const { detailsRef, closeDetails } = useSongDetailsNav(onClose, multiplayerOpen);
  const { mutate: preparePlayback, isLoading: preparingPlayback } = usePreparePlaybackMutation();
  const { launch, reserveTarget } = usePlaybackLauncher();
  const [tempo, setTempo] = useState(song.tempo);
  const [keyOffset, setKeyOffset] = useState(song.key_offset);

  const status = getSongStatusInfo(song.is_analyzed, queueStatus);
  const analysisBusy = queueStatus === 'Queued' || Boolean(status.isAnalyzing);
  // LRC songs played over the original mix are playable immediately while their
  // key is still being detected off-queue. Until the key lands, treat the
  // key/tempo section as pending rather than showing controls.
  const keyPending = hasPendingKey(song);
  const supportsShifts = song.is_analyzed && song.transcript_source !== 'Usdx' && !keyPending;
  const supportsAnalysisActions = status.isReady === true && song.transcript_source !== 'Usdx';
  const playbackDisabled = status.isReady !== true || preparingPlayback;

  // Off-queue key detection doesn't invalidate any query, so poll the song list
  // while the key is pending to pick it up and unlock the shift controls.
  useEffect(() => {
    if (!keyPending) {
      return undefined;
    }
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: SONGS });
    }, 2000);
    return () => clearInterval(interval);
  }, [keyPending, queryClient]);

  const handlePlay = (players?: PlaybackPlayer[]) => {
    const target = reserveTarget();
    if (target === undefined) {
      return;
    }
    const start = (preparedSong: Song) =>
      launch({ song: preparedSong, queuePlayback: false, players }, target);
    const hasAdjustments = keyOffset !== song.key_offset || tempo !== song.tempo;

    if (!hasAdjustments) {
      void start(song);
      return;
    }

    preparePlayback(
      { song, tempo, keyOffset },
      {
        onSuccess: (preparedSong) => void start(preparedSong),
        onError: () => target?.close(),
      },
    );
  };

  return (
    <aside
      ref={detailsRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l bg-background [&_[data-song-details-focused=true]]:z-10 [&_[data-song-details-focused=true]]:ring-2 [&_[data-song-details-focused=true]]:ring-primary xl:w-[28rem] xl:flex-none"
      aria-label={t('songDetails.label')}
    >
      <SongDetailsHeader
        song={song}
        queueStatus={queueStatus}
        bestScore={bestScores.get(song.file_hash)}
        onClose={closeDetails}
      />

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <AnalysisFailure queueStatus={queueStatus} />
        <KeyTempoSection
          song={song}
          supportsShifts={supportsShifts}
          tempo={tempo}
          keyOffset={keyOffset}
          disabled={preparingPlayback}
          onTempoChange={setTempo}
          onKeyOffsetChange={setKeyOffset}
        />

        <Separator />

        <ActionsSection
          song={song}
          status={status}
          analysisBusy={analysisBusy}
          supportsAnalysisActions={supportsAnalysisActions}
        />
      </div>

      <footer className="flex flex-col gap-2 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button
          size="lg"
          data-song-details-primary
          className="h-12 w-full text-base disabled:bg-primary/50 disabled:text-primary-foreground/45 disabled:opacity-100"
          disabled={status.isReady !== true || preparingPlayback}
          aria-busy={preparingPlayback}
          onClick={() => handlePlay()}
        >
          {preparingPlayback ? (
            <>
              <Spinner className="size-4" /> {t('songDetails.preparing')}
            </>
          ) : (
            <>
              <PlayIcon /> {t('songDetails.play')}
            </>
          )}
        </Button>
        <div className="grid grid-cols-2 gap-2" data-song-details-nav-group>
          <Button
            variant="outline"
            size="lg"
            className="h-11"
            disabled={playbackDisabled}
            onClick={() => setMultiplayerOpen(true)}
            aria-label={t('songDetails.multiplayerLabel', { title: song.title })}
          >
            <UsersIcon />
            {t('songDetails.multiplayer')}
          </Button>
          <AddToQueueButton
            song={song}
            tempo={tempo}
            keyOffset={keyOffset}
            ready={status.isReady === true}
            preparing={preparingPlayback}
          />
        </div>
      </footer>

      <MultiplayerSetupDialog
        open={multiplayerOpen}
        onOpenChange={setMultiplayerOpen}
        onStart={handlePlay}
      />
    </aside>
  );
};
