import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { switchProfile } from '@/bridge/profile';
import { reportRemoteStatus, type RemoteStartCommand } from '@/bridge/remote-control';
import { playbackPlayersSchema } from '@/bridge/schemas';
import { loadSongsByHashes } from '@/bridge/songs';
import { getSongStatusInfo } from '@/features/library/components/song/song-status';
import {
  usePlaybackQueueQuery,
  useStartNextPlaybackQueueSong,
} from '@/features/playback-queue/use-playback-queue';
import { usePlaybackLauncher } from '@/features/playback/hooks/use-playback-launcher';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import { useI18n } from '@/shared/i18n/use-i18n';
import { PROFILES } from '@/shared/query-keys';

import { useRemoteCommand } from './use-remote-command';

/** Starts songs and the queue for the phone remote while the TV shows the menu. */
export function useRemoteMenuControl() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { launch, reserveTarget, sessionMode } = usePlaybackLauncher();
  const { data: entries = [] } = usePlaybackQueueQuery();
  const { playNext, nextEntryId, analysis } = useStartNextPlaybackQueueSong(entries);
  const { mutateAsync: saveConfig } = useConfigMutation();

  useEffect(() => {
    if (!sessionMode) {
      void reportRemoteStatus({ screen: 'menu' }).catch(() => undefined);
    }
  }, [sessionMode]);

  const applyMode = async (mode: RemoteStartCommand['mode']): Promise<PlaybackPlayer[]> => {
    if (mode.kind === 'multiplayer') {
      const players = playbackPlayersSchema.parse(mode.players);
      await saveConfig({ multiplayer_players: players });
      return players;
    }
    if (mode.microphoneId !== null) {
      await saveConfig({ preferred_mic: mode.microphoneId });
    }
    if (mode.profile !== null) {
      await switchProfile(mode.profile);
      await queryClient.invalidateQueries({ queryKey: PROFILES });
    }
    return [];
  };

  const startSong = async (fileHash: string, players: PlaybackPlayer[]): Promise<void> => {
    const song = (await loadSongsByHashes([fileHash])).at(0);
    if (
      song === undefined ||
      getSongStatusInfo(song.is_analyzed, analysis?.entries[song.file_hash]).isReady !== true
    ) {
      throw new Error(t('remote.songNotReady'));
    }
    const playbackTarget = reserveTarget();
    if (playbackTarget !== undefined) {
      await launch(
        { song, queuePlayback: false, players: players.length > 0 ? players : undefined },
        playbackTarget,
      );
    }
  };

  const start = async ({ target, mode }: RemoteStartCommand): Promise<void> => {
    const players = await applyMode(mode);
    if (target.kind === 'song') {
      await startSong(target.fileHash, players);
    } else if (nextEntryId === undefined) {
      throw new Error(t('remote.noReadySong'));
    } else {
      playNext(players);
    }
  };

  useRemoteCommand({
    monitorGain: ({ value }) => {
      void saveConfig({ mic_monitor_gain: value }).catch(() => undefined);
    },
    start: (command) => {
      void start(command).catch((error: unknown) => {
        toast.error(
          t('remote.startFailed', {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    },
  });
}
