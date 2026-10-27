import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import { type NavAction, useNavInput } from '@/features/menu/hooks/use-nav-input';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import {
  usePlaybackMicActions,
  usePlaybackThemeActions,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { skipTarget } from '@/features/playback/utils/lyrics-gap';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import type { AppConfig } from '@/types/AppConfig';

/** Step used by the `=` / `-` guide hotkeys and the Left/Right arrows. */
const GUIDE_VOLUME_STEP = 0.1;
/** Step used by the Up/Down arrows for the master output (speaker) volume. */
const OUTPUT_VOLUME_STEP = 0.1;
/** Coalesce rapid arrow repeats into a single volume config write. */
const VOLUME_PERSIST_DEBOUNCE_MS = 400;

/**
 * Coalesces rapid volume steps (held arrow keys, remote repeats) into a single
 * debounced `persistConfig` write. The value is read from `volumeRef` when the
 * timer fires, so the last step of a held key is what gets persisted, and the
 * unmount flush writes any pending change when the session exits inside the
 * debounce window.
 */
function useDebouncedVolumePersist(
  persistVolume: (volume: number) => void,
  volumeRef: MutableRefObject<number>,
) {
  const persistVolumeRef = useLatestRef(persistVolume);
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current === null) {
      return;
    }
    timerRef.current = null;
    persistVolumeRef.current(volumeRef.current);
  }, [persistVolumeRef, volumeRef]);

  const schedule = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      persistVolumeRef.current(volumeRef.current);
    }, VOLUME_PERSIST_DEBOUNCE_MS);
  }, [persistVolumeRef, volumeRef]);

  // Flush a pending debounced write on unmount so the last adjustment isn't
  // lost when the session exits within the debounce window.
  useEffect(() => flush, [flush]);

  return { schedule };
}

export type PlaybackVolumeControls = {
  applyOutputVolume: (volume: number) => void;
  applyGuideVolume: (volume: number) => void;
};

type KeyboardActions = {
  paused: boolean;
  guideVolume: number;
  guideAvailable: boolean;
  setGuideVolume: (volume: number) => void;
  persistConfig: (patch: Partial<AppConfig>) => void;
  handlePause: () => void;
  handleContinue: () => void;
  cycleTheme: () => void;
  cycleFlavor: () => void;
  handleToggleMic: () => void;
  handleCycleMic: () => void;
  handleToggleMicMonitor: () => void;
};

function handleGuideKey(key: string, actions: KeyboardActions): boolean {
  let next: number;
  if (key === 'g' || key === 'G') {
    next = actions.guideVolume > 0 ? 0 : 0.3;
  } else if (key === '=' || key === '+') {
    next = actions.guideVolume + GUIDE_VOLUME_STEP;
  } else if (key === '-') {
    next = actions.guideVolume - GUIDE_VOLUME_STEP;
  } else {
    return false;
  }

  if (actions.guideAvailable) {
    actions.setGuideVolume(next);
    actions.persistConfig({ guide_volume: next });
  }
  return true;
}

function handleKeyboardShortcut(event: KeyboardEvent, actions: KeyboardActions): void {
  if (event.key === ' ') {
    event.preventDefault();
    if (actions.paused) {
      actions.handleContinue();
    } else {
      actions.handlePause();
    }
    return;
  }
  if (actions.paused || handleGuideKey(event.key, actions)) {
    return;
  }

  const shortcuts: Readonly<Record<string, () => void>> = {
    t: actions.cycleTheme,
    f: actions.cycleFlavor,
    m: actions.handleToggleMic,
    n: actions.handleCycleMic,
    r: actions.handleToggleMicMonitor,
  };
  shortcuts[event.key.toLowerCase()]?.();
}

/**
 * Up/down adjust the master output (speaker) volume only while a song is
 * actively playing; returns true when the nav action was consumed so it
 * doesn't fall through to navigation. Outside that state the arrows stay nav.
 */
function handleOutputVolumeNav(
  action: NavAction,
  active: boolean,
  currentVolume: number,
  applyVolume: (volume: number) => void,
): boolean {
  if (!active || (!action.up && !action.down)) {
    return false;
  }
  const delta = action.up ? OUTPUT_VOLUME_STEP : -OUTPUT_VOLUME_STEP;
  applyVolume(currentVolume + delta);
  return true;
}

/**
 * Left/right adjust the guide vocal volume only while a song is actively
 * playing and guide vocals are available (right = louder, left = quieter,
 * matching the "right increases" convention of the settings sliders). Returns
 * true when the nav action was consumed; when the guide is unavailable the
 * arrows stay navigation.
 */
function handleGuideVolumeNav(
  action: NavAction,
  active: boolean,
  currentVolume: number,
  applyVolume: (volume: number) => void,
): boolean {
  if (!active || (!action.left && !action.right)) {
    return false;
  }
  const delta = action.right ? GUIDE_VOLUME_STEP : -GUIDE_VOLUME_STEP;
  applyVolume(currentVolume + delta);
  return true;
}

/**
 * Wires keyboard + gamepad input for the playback session. Reads everything it
 * needs from the playback contexts; only the app config is passed in so we can
 * persist volume changes without coupling this hook to the config query.
 *
 * The Up/Down arrows (keyboard, gamepad, CEC remote) drive the master output
 * volume — the level of the whole playback mix reaching the soundbar — kept
 * separate from the microphone monitor path. The Left/Right arrows drive the
 * guide vocal volume while guide vocals are available. Both go through an
 * `apply*Volume` callback that clamps to [0, 1], updates the audio engine
 * immediately, and coalesces the config write so held keys or repeats don't
 * hit disk on every step. The same callbacks are returned for the pause menu.
 */
export function usePlaybackInput(config: AppConfig | null): PlaybackVolumeControls {
  const { paused, isReady, isPlaying, guideVolume, guideAvailable, outputVolume } =
    usePlaybackTransportState();
  const { setGuideVolume, setOutputVolume, handlePause, handleContinue, getCurrentTime } =
    usePlaybackTransportActions();
  const { segments, firstSegmentStart, lastSegmentEnd, introSkipLeadSec } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { cycleTheme, cycleFlavor } = usePlaybackThemeActions();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();

  const persistConfig = usePlaybackConfigPersist(config);

  const pausedRef = useLatestRef(paused);
  const outputVolumeRef = useLatestRef(outputVolume);
  const guideVolumeRef = useLatestRef(guideVolume);

  const persistOutputVolume = useCallback(
    (volume: number) => persistConfig({ output_volume: volume }),
    [persistConfig],
  );
  const persistGuideVolume = useCallback(
    (volume: number) => persistConfig({ guide_volume: volume }),
    [persistConfig],
  );

  const outputPersist = useDebouncedVolumePersist(persistOutputVolume, outputVolumeRef);
  const guidePersist = useDebouncedVolumePersist(persistGuideVolume, guideVolumeRef);

  const applyOutputVolume = useCallback(
    (volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      // Mirror into the ref immediately so key/gamepad repeats step from the
      // latest value even before the state re-render lands.
      outputVolumeRef.current = clamped;
      setOutputVolume(clamped);
      outputPersist.schedule();
    },
    [outputVolumeRef, setOutputVolume, outputPersist],
  );

  const applyGuideVolume = useCallback(
    (volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      guideVolumeRef.current = clamped;
      setGuideVolume(clamped);
      guidePersist.schedule();
    },
    [guideVolumeRef, setGuideVolume, guidePersist],
  );

  const handleConfirm = useCallback(() => {
    const skip = skipTarget(getCurrentTime(), {
      segmentCount: segments.length,
      firstSegmentStart,
      lastSegmentEnd,
      introSkipLeadSec,
    });
    if (skip === 'intro') {
      handleSkipIntro();
    } else if (skip === 'outro') {
      handleSkipOutro();
    } else {
      handleToggleMicMonitor();
    }
  }, [
    firstSegmentStart,
    getCurrentTime,
    handleSkipIntro,
    handleSkipOutro,
    handleToggleMicMonitor,
    introSkipLeadSec,
    lastSegmentEnd,
    segments.length,
  ]);

  // Nav input (keyboard arrows + CEC remote + gamepad):
  // - back = pause/resume
  // - up/down = master output (speaker) volume while a song is actively playing
  // - left/right = guide vocal volume while a song plays with guide vocals
  // - confirm = skip the intro/outro while that skip is offered, otherwise
  //   toggle microphone monitoring without disabling scoring
  // Arrows are only consumed while `isPlaying && !paused`; otherwise they fall
  // through untouched (the paused dialog still navigates with them, and outside
  // this screen other nav consumers keep working as before).
  useNavInput(
    useCallback(
      (action) => {
        if (action.back) {
          (pausedRef.current ? handleContinue : handlePause)();
          return;
        }
        if (pausedRef.current) {
          return;
        }

        if (handleOutputVolumeNav(action, isPlaying, outputVolumeRef.current, applyOutputVolume)) {
          return;
        }

        if (
          handleGuideVolumeNav(
            action,
            isPlaying && guideAvailable,
            guideVolumeRef.current,
            applyGuideVolume,
          )
        ) {
          return;
        }

        if (action.confirm && isReady && isPlaying) {
          handleConfirm();
        }
      },
      [
        handleConfirm,
        handlePause,
        handleContinue,
        pausedRef,
        isReady,
        isPlaying,
        guideAvailable,
        applyOutputVolume,
        outputVolumeRef,
        applyGuideVolume,
        guideVolumeRef,
      ],
    ),
  );

  // Keyboard-only shortcuts (G, T, F, M, N, R, +/-, Space)
  useEffect(() => {
    const actions: KeyboardActions = {
      paused,
      guideVolume,
      guideAvailable,
      setGuideVolume,
      persistConfig,
      handlePause,
      handleContinue,
      cycleTheme,
      cycleFlavor,
      handleToggleMic,
      handleCycleMic,
      handleToggleMicMonitor,
    };
    const onKeyDown = (event: KeyboardEvent) => handleKeyboardShortcut(event, actions);

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    paused,
    guideVolume,
    guideAvailable,
    setGuideVolume,
    persistConfig,
    cycleTheme,
    cycleFlavor,
    handlePause,
    handleContinue,
    handleToggleMic,
    handleCycleMic,
    handleToggleMicMonitor,
  ]);

  return { applyOutputVolume, applyGuideVolume };
}
