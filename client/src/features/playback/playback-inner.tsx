/**
 * Playback session: audio engine, visual background, lyrics HUD, and pause overlay.
 * Route shell (`Playback`) keys this session so state resets for every queued entry.
 *
 * `PlaybackInner` itself is the provider shell; `PlaybackLayout` is the
 * presentational tree that consumes the playback contexts via hooks.
 */

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { isTauri } from '@/bridge/runtime';
import { Background } from '@/features/playback/components/background';
import { ResultDialog } from '@/features/playback/components/dialogs/result';
import { LoadingScreen } from '@/features/playback/components/loading-screen';
import { LyricsDisplay } from '@/features/playback/components/lyrics-display';
import { PauseMenu } from '@/features/playback/components/pause-menu';
import { PitchDisplay } from '@/features/playback/components/pitch-display';
import { PlaybackHud } from '@/features/playback/components/playback-hud';
import { PlaybackOsd } from '@/features/playback/components/playback-osd';
import { usePlaybackInput, usePlaybackResult } from '@/features/playback/hooks';
import {
  PlaybackProviders,
  usePlaybackTranscriptState,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { useI18n } from '@/shared/i18n/use-i18n';
import type { AppConfig } from '@/types/AppConfig';
import type { Song } from '@/types/Song';

export type PlaybackInnerProps = {
  song: Song;
  config: AppConfig | null;
  queuePlayback: boolean;
  sessionPlayback: boolean;
  players?: readonly PlaybackPlayer[];
};

type PlaybackLayoutProps = PlaybackInnerProps;

function displaySettings(config: AppConfig | null) {
  return {
    lyricsVerticalPosition: config?.lyrics_vertical_position ?? 'bottom',
    lyricsHorizontalPosition: config?.lyrics_horizontal_position ?? 'center',
    lyricsScale: config?.lyrics_scale,
    pitchGraphScale: config?.pitch_graph_scale,
    romanizationMode: config?.lyrics_romanization_mode ?? 'enabled',
  };
}

function PlaybackLayout({
  song,
  config,
  queuePlayback,
  sessionPlayback,
  players,
}: PlaybackLayoutProps) {
  const { t } = useI18n();
  const { isReady, paused, guideAvailable } = usePlaybackTransportState();
  const { segments } = usePlaybackTranscriptState();
  const {
    lyricsVerticalPosition,
    lyricsHorizontalPosition,
    lyricsScale,
    pitchGraphScale,
    romanizationMode,
  } = displaySettings(config);
  const hudPosition = lyricsVerticalPosition === 'top' ? 'bottom' : 'top';
  const sessionWindowControls = sessionPlayback && isTauri;

  const volume = usePlaybackInput(config);
  const result = usePlaybackResult(song, queuePlayback, players);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" style={{ contain: 'strict' }}>
      <Background />
      {!isReady && <LoadingScreen song={song} />}

      {isReady && (
        <div className="absolute inset-(--tv-safe-area)">
          <PlaybackHud
            title={song.title}
            artist={song.artist}
            position={hudPosition}
            windowControls={sessionWindowControls}
          />
          <PitchDisplay
            mode={config?.pitch_display}
            position={hudPosition}
            scale={pitchGraphScale}
          />
          <LyricsDisplay
            segments={segments}
            verticalPosition={lyricsVerticalPosition}
            horizontalPosition={lyricsHorizontalPosition}
            scale={lyricsScale}
            romanizationMode={romanizationMode}
          />
        </div>
      )}

      {isReady && <PlaybackOsd />}

      <PauseMenu
        open={paused && !result.open}
        exitLabel={sessionPlayback ? t('playback.exitPlayback') : t('playback.exitToMenu')}
        volume={volume}
      />

      <ResultDialog
        open={result.open}
        results={result.results}
        score={result.score}
        report={result.report}
        guideAvailable={guideAvailable}
        song={song}
        scores={result.scores}
        activeProfile={result.activeProfile}
        nextPending={result.nextPending}
        exitLabel={sessionPlayback ? t('playback.exitPlayback') : t('playback.backToMenu')}
        onBack={result.onBack}
        onNext={result.onNext}
      />
    </div>
  );
}

export function PlaybackInner({
  song,
  config,
  queuePlayback,
  sessionPlayback,
  players,
}: PlaybackInnerProps) {
  return (
    <PlaybackProviders song={song} config={config} players={players}>
      <PlaybackLayout
        song={song}
        config={config}
        queuePlayback={queuePlayback}
        sessionPlayback={sessionPlayback}
        players={players}
      />
    </PlaybackProviders>
  );
}
