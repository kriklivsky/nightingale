import { useEffect } from 'react';

import { reportRemoteStatus, type RemoteTvStatus } from '@/bridge/remote-control';
import type { PlaybackResult } from '@/features/playback/hooks';
import type { PlaybackVolumeControls } from '@/features/playback/hooks/use-playback-input';
import {
  usePlaybackMicActions,
  usePlaybackMicState,
  usePlaybackThemeActions,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import type { Song } from '@/types/Song';

import { useRemoteCommand } from './use-remote-command';

const STATUS_INTERVAL_MS = 500;

type RemotePlaybackControlInput = {
  song: Song;
  volume: PlaybackVolumeControls;
  result: PlaybackResult;
};

const report = (status: RemoteTvStatus): void => {
  void reportRemoteStatus(status).catch(() => undefined);
};

/** Reports the playing song to the phone remote and runs its playback commands. */
export function useRemotePlaybackControl({ song, volume, result }: RemotePlaybackControlInput) {
  const transport = usePlaybackTransportState();
  const transportActions = usePlaybackTransportActions();
  const mic = usePlaybackMicState();
  const micActions = usePlaybackMicActions();
  const { cycleTheme } = usePlaybackThemeActions();
  const { mutate: saveConfig } = useConfigMutation();

  const status: RemoteTvStatus = {
    screen: 'playback',
    fileHash: song.file_hash,
    title: song.title,
    artist: song.artist,
    ready: transport.isReady,
    paused: transport.paused,
    resultOpen: result.open,
    positionSec: 0,
    durationSec: transport.duration,
    outputVolume: transport.outputVolume,
    guideVolume: transport.guideVolume,
    guideAvailable: transport.guideAvailable,
    micEnabled: mic.micUserEnabled,
    monitorEnabled: mic.micMonitorUserEnabled,
    multiplayer: mic.multiplayer,
    canSkip: result.canSkip,
  };
  const statusRef = useLatestRef(status);
  const getCurrentTimeRef = useLatestRef(transportActions.getCurrentTime);

  useEffect(() => {
    const send = () =>
      report({ ...statusRef.current, positionSec: Math.max(0, getCurrentTimeRef.current()) });
    send();
    const timer = window.setInterval(send, STATUS_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      report({ screen: 'menu' });
    };
  }, [getCurrentTimeRef, statusRef]);

  const { paused, duration, guideAvailable } = transport;
  const { getCurrentTime, seek, handlePause, handleContinue, handleRestart, handleExit } =
    transportActions;

  useRemoteCommand({
    pause: () => {
      if (!paused && !result.open) {
        handlePause();
      }
    },
    resume: () => {
      if (paused) {
        handleContinue();
      }
    },
    restart: () => handleRestart(),
    stop: () => (result.open ? result.onBack() : handleExit()),
    next: () => (result.open && result.onNext !== undefined ? result.onNext() : result.skip()),
    seek: ({ deltaSec }) => seek(Math.min(duration, Math.max(0, getCurrentTime() + deltaSec))),
    outputVolume: ({ value }) => volume.applyOutputVolume(value),
    guideVolume: ({ value }) => {
      if (guideAvailable) {
        volume.applyGuideVolume(value);
      }
    },
    toggleMic: () => micActions.handleToggleMic(),
    toggleMonitor: () => micActions.handleToggleMicMonitor(),
    background: () => cycleTheme(),
    monitorGain: ({ value }) => saveConfig({ mic_monitor_gain: value }),
  });
}
