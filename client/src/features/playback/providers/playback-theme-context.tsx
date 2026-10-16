/**
 * Owns visual background selection, Pixabay flavor, and playable song-video path.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { ensurePlayableSourceVideo } from '@/bridge/playback';
import {
  createPlaybackThemes,
  initialThemeKey,
  nextFlavorIndex,
  nextThemeKey,
  selectionForTheme,
  themeKey,
  type PlaybackTheme,
} from '@/features/playback/components/theme';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import { FLAVORS, type VideoFlavor } from '@/features/playback/lib/video-flavor';
import { useSongVideo } from '@/features/song-video/queries';
import type { AppConfig } from '@/types/AppConfig';
import type { Song } from '@/types/Song';

export type PlaybackThemeState = {
  theme: PlaybackTheme;
  videoFlavor: VideoFlavor;
  sourceVideoPath: string | undefined;
  sourceVideoTempoRatio: number;
  sourceVideoOffsetSec: number;
};

export type PlaybackThemeActions = {
  cycleTheme: () => void;
  cycleFlavor: () => void;
};

const ThemeStateContext = createContext<PlaybackThemeState | null>(null);
const ThemeActionsContext = createContext<PlaybackThemeActions | null>(null);

type PlaybackThemeProviderProps = {
  song: Song;
  config: AppConfig | null;
  children: ReactNode;
};

type PlayableVideo = { fileHash: string; path: string };

function resolveSourceVideoPath(
  song: Song,
  playableVideo: PlayableVideo | null,
): string | undefined {
  if (!song.is_video && typeof song.usdx?.video !== 'string') {
    return undefined;
  }
  return playableVideo?.fileHash === song.file_hash
    ? playableVideo.path
    : (song.usdx?.video ?? song.path);
}

function useSourceVideo(song: Song) {
  const fileHash = song.file_hash;
  const { data: attachedVideo, error: videoError } = useSongVideo(fileHash);
  const hasAuthoredVideo = song.is_video || typeof song.usdx?.video === 'string';
  const [playableVideo, setPlayableVideo] = useState<PlayableVideo | null>(null);

  useEffect(() => {
    if (!hasAuthoredVideo) {
      return undefined;
    }

    let cancelled = false;
    void ensurePlayableSourceVideo(fileHash)
      .then((path) => {
        if (!cancelled && typeof path === 'string' && path !== '') {
          setPlayableVideo({ fileHash, path });
        }
        return undefined;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [fileHash, hasAuthoredVideo]);

  const sourceVideoPath = attachedVideo?.path ?? resolveSourceVideoPath(song, playableVideo);

  useEffect(() => {
    if (videoError instanceof Error) {
      toast.error(`Cannot load the song video: ${videoError.message}`);
    }
  }, [videoError]);

  return { sourceVideoPath, sourceVideoOffsetSec: attachedVideo?.offset_sec ?? 0 };
}

function configuredThemeKey(
  themes: readonly PlaybackTheme[],
  hasSourceVideo: boolean,
  config: AppConfig | null,
): string {
  return initialThemeKey({
    themes,
    hasSourceVideo,
    selection: config?.last_background,
    legacyIndex: config?.last_theme ?? 0,
  });
}

export function PlaybackThemeProvider({ song, config, children }: PlaybackThemeProviderProps) {
  const { sourceVideoPath, sourceVideoOffsetSec } = useSourceVideo(song);
  const hasSourceVideo = sourceVideoPath !== undefined;
  const themes = useMemo(
    () => createPlaybackThemes(config?.custom_backgrounds ?? [], hasSourceVideo),
    [config?.custom_backgrounds, hasSourceVideo],
  );
  const [selectedThemeKey, setCurrentThemeKey] = useState<string | null>(null);
  const currentThemeKey = selectedThemeKey ?? configuredThemeKey(themes, hasSourceVideo, config);
  const [flavorIndex, setFlavorIndex] = useState(config?.last_video_flavor ?? 0);
  const theme = themes.find((candidate) => themeKey(candidate) === currentThemeKey) ?? themes[0];
  const persistConfig = usePlaybackConfigPersist(config);

  const cycleTheme = useCallback(() => {
    setCurrentThemeKey((current) => {
      const nextKey = nextThemeKey(themes, current ?? currentThemeKey);
      const next = themes.find((candidate) => themeKey(candidate) === nextKey);
      const selection = next ? selectionForTheme(next) : null;
      if (selection) {
        persistConfig({ last_background: selection });
      }
      return nextKey;
    });
  }, [currentThemeKey, persistConfig, themes]);

  const cycleFlavor = useCallback(() => {
    setFlavorIndex((current) => {
      const next = nextFlavorIndex(current);
      persistConfig({ last_video_flavor: next });
      return next;
    });
  }, [persistConfig]);

  const stateValue = useMemo<PlaybackThemeState>(
    () => ({
      theme,
      videoFlavor: FLAVORS[flavorIndex % FLAVORS.length],
      sourceVideoPath,
      sourceVideoTempoRatio: song.tempo,
      sourceVideoOffsetSec,
    }),
    [theme, flavorIndex, sourceVideoPath, song.tempo, sourceVideoOffsetSec],
  );

  const actionsValue = useMemo<PlaybackThemeActions>(
    () => ({ cycleTheme, cycleFlavor }),
    [cycleTheme, cycleFlavor],
  );

  return (
    <ThemeStateContext.Provider value={stateValue}>
      <ThemeActionsContext.Provider value={actionsValue}>{children}</ThemeActionsContext.Provider>
    </ThemeStateContext.Provider>
  );
}

export function usePlaybackThemeState(): PlaybackThemeState {
  const ctx = useContext(ThemeStateContext);
  if (!ctx) {
    throw new Error('usePlaybackThemeState must be used within a PlaybackThemeProvider');
  }
  return ctx;
}

export function usePlaybackThemeActions(): PlaybackThemeActions {
  const ctx = useContext(ThemeActionsContext);
  if (!ctx) {
    throw new Error('usePlaybackThemeActions must be used within a PlaybackThemeProvider');
  }
  return ctx;
}
