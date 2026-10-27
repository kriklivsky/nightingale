import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { useLatestRef } from '@/shared/hooks/use-latest-ref';

const PLAYBACK_RATE_MIN = 0.25;
const PLAYBACK_RATE_MAX = 4;

/** Drift (seconds, source-video time) tolerated before a corrective seek. */
const RESEEK_DRIFT_SEC = 0.35;
/** Minimum spacing of corrective seeks while drift persists. */
const RESEEK_INTERVAL_MS = 4000;
/** A drift this large is a deliberate jump (skip, restart) and re-seeks at once. */
const JUMP_DRIFT_SEC = 3;
/** Initial estimate of how long a seek takes before the clip shows frames again. */
const INITIAL_SEEK_LATENCY_SEC = 0.5;
const MIN_SEEK_LATENCY_SEC = 0.1;
const MAX_SEEK_LATENCY_SEC = 2;
const SEEK_LATENCY_SMOOTHING = 0.6;
const SEEK_END_PADDING_SEC = 0.05;

type UseSourceVideoSyncOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string | null;
  isPlaying: boolean;
  tempoRatio: number;
  offsetSec?: number;
  subscribe: (fn: (time: number) => void) => () => void;
  getCurrentTime: () => number;
};

type SyncState = {
  /** performance.now() of the seek in flight, or null. */
  seekStartedAt: number | null;
  lastSeekAt: number;
  /** Smoothed measured seek duration (seconds), used as the seek lead. */
  seekLatencySec: number;
  /** False until the first seek lands, so the clip never flashes its opening frame. */
  revealed: boolean;
  /** The media element reported an error; the clip stays hidden. */
  failed: boolean;
};

const initialSyncState = (): SyncState => ({
  seekStartedAt: null,
  lastSeekAt: 0,
  seekLatencySec: INITIAL_SEEK_LATENCY_SEC,
  revealed: false,
  failed: false,
});

function safePlay(video: HTMLVideoElement): void {
  void video.play().catch(() => {});
}

function normalizeRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 1;
  }

  return ratio;
}

function enforceSilent(video: HTMLVideoElement): void {
  // Some browsers ignore one or two of these in isolation; setting all three
  // is the only reliable way to keep the source video silent.
  video.defaultMuted = true;
  video.muted = true;
  video.volume = 0;
}

function setRate(video: HTMLVideoElement, rate: number): void {
  const clamped = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, rate));
  if (Math.abs(video.playbackRate - clamped) > 1e-3) {
    video.playbackRate = clamped;
  }
}

function clampToClip(target: number, video: HTMLVideoElement): number {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Math.max(0, Math.min(target, Math.max(0, video.duration - SEEK_END_PADDING_SEC)));
  }

  return Math.max(0, target);
}

/** WebKit can drop seeks issued before preroll, so wait until the clip can play. */
const clipCanStart = (video: HTMLVideoElement): boolean =>
  Number.isFinite(video.duration) &&
  video.duration > 0 &&
  video.readyState >= video.HAVE_FUTURE_DATA;

/**
 * Seeks where the song will be once the seek completes. The clip keeps playing
 * through the seek: pausing adds preroll latency on GStreamer-backed WebKit.
 */
function seekAhead(video: HTMLVideoElement, target: number, ratio: number, state: SyncState): void {
  const lead = video.paused ? 0 : state.seekLatencySec * ratio;
  state.seekStartedAt = performance.now();
  state.lastSeekAt = state.seekStartedAt;
  video.currentTime = clampToClip(target + lead, video);
}

function recordSeekLatency(state: SyncState): void {
  if (state.seekStartedAt === null) {
    return;
  }
  const sample = (performance.now() - state.seekStartedAt) / 1000;
  state.seekStartedAt = null;
  const bounded = Math.min(MAX_SEEK_LATENCY_SEC, Math.max(MIN_SEEK_LATENCY_SEC, sample));
  state.seekLatencySec =
    state.seekLatencySec * SEEK_LATENCY_SMOOTHING + bounded * (1 - SEEK_LATENCY_SMOOTHING);
}

/** Re-seeks a drifting clip; small drift is left alone because every correction costs a stall. */
function correctDrift(video: HTMLVideoElement, target: number, ratio: number, state: SyncState) {
  if (video.seeking || state.seekStartedAt !== null) {
    return;
  }
  const drift = Math.abs(video.currentTime - target);
  if (drift <= RESEEK_DRIFT_SEC) {
    return;
  }
  if (drift > JUMP_DRIFT_SEC || performance.now() - state.lastSeekAt > RESEEK_INTERVAL_MS) {
    seekAhead(video, target, ratio, state);
  }
}

/** Outside the clip's span: stay paused, parked on the first frame before it starts. */
function parkOutsideClip(video: HTMLVideoElement, target: number, ratio: number, state: SyncState) {
  if (!video.paused) {
    video.pause();
  }
  if (target < 0 && video.currentTime > 0 && !video.seeking) {
    seekAhead(video, 0, ratio, state);
  }
}

function followPlayState(video: HTMLVideoElement, playing: boolean) {
  if (playing && video.paused) {
    safePlay(video);
  } else if (!playing && !video.paused) {
    video.pause();
  }
}

/**
 * Keeps a muted clip locked to the song using a constant offset: the clip is
 * never time-stretched to fit the song. Outside the clip's span, or after a
 * media error, it is hidden (`visible: false`) so callers can show another
 * background. The playback rate only follows the song tempo; drift is fixed by
 * occasional seeks that lead by the measured seek latency, because rate changes
 * and paused seeks stall GStreamer-backed WebKit.
 */
export function useSourceVideoSync({
  videoRef,
  src,
  isPlaying,
  tempoRatio,
  offsetSec = 0,
  subscribe,
  getCurrentTime,
}: UseSourceVideoSyncOptions): { ready: boolean; visible: boolean } {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const readyRef = useRef(false);
  const stateRef = useRef<SyncState>(initialSyncState());
  const isPlayingRef = useLatestRef(isPlaying);

  const ratio = normalizeRatio(tempoRatio);
  const toSourceTime = useCallback(
    (audioTime: number) => audioTime * ratio + offsetSec,
    [offsetSec, ratio],
  );

  const synchronize = useCallback(
    (video: HTMLVideoElement, time: number) => {
      const state = stateRef.current;
      const target = toSourceTime(time);
      const inClip = target >= 0 && target < video.duration;

      setVisible(inClip && state.revealed && !state.failed);
      if (state.failed) {
        return;
      }
      if (!inClip) {
        parkOutsideClip(video, target, ratio, state);
        return;
      }

      correctDrift(video, target, ratio, state);
      followPlayState(video, isPlayingRef.current);
    },
    [isPlayingRef, ratio, toSourceTime],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof src !== 'string' || src === '') {
      return undefined;
    }

    readyRef.current = false;
    setReady(false);
    setVisible(false);
    stateRef.current = initialSyncState();
    enforceSilent(video);
    setRate(video, ratio);

    const start = () => {
      if (!clipCanStart(video) || readyRef.current) {
        return;
      }
      const target = toSourceTime(getCurrentTime());
      if (target > 0 && target < video.duration) {
        // Seeking before the first play is the most reliable path; account for
        // the song advancing while the seek completes.
        seekAhead(video, target + stateRef.current.seekLatencySec * ratio, ratio, stateRef.current);
      } else {
        stateRef.current.revealed = true;
      }
      readyRef.current = true;
      setReady(true);
      synchronize(video, getCurrentTime());
    };

    const onSeeked = () => {
      recordSeekLatency(stateRef.current);
      if (!stateRef.current.revealed) {
        stateRef.current.revealed = true;
        synchronize(video, getCurrentTime());
      }
    };

    const onError = () => {
      stateRef.current.failed = true;
      setVisible(false);
    };

    start();
    video.addEventListener('loadedmetadata', start);
    video.addEventListener('durationchange', start);
    video.addEventListener('canplay', start);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('loadedmetadata', start);
      video.removeEventListener('durationchange', start);
      video.removeEventListener('canplay', start);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
  }, [getCurrentTime, ratio, src, synchronize, toSourceTime, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !readyRef.current) {
      return;
    }

    enforceSilent(video);
    setRate(video, ratio);
    if (isPlaying) {
      synchronize(video, getCurrentTime());
    } else {
      video.pause();
    }
  }, [getCurrentTime, isPlaying, ratio, synchronize, videoRef]);

  useEffect(() => {
    return subscribe((time) => {
      const video = videoRef.current;
      if (!video || !readyRef.current) {
        return;
      }

      synchronize(video, time);
    });
  }, [subscribe, synchronize, videoRef]);

  return { ready, visible };
}
