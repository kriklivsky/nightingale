import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { useLatestRef } from '@/shared/hooks/use-latest-ref';

const DRIFT_CORRECT_SEC = 0.5;
const DRIFT_THROTTLE_MS = 500;

const PLAYBACK_RATE_MIN = 0.25;
const PLAYBACK_RATE_MAX = 4;

const INITIAL_SEEK_SKIP_THRESHOLD_SEC = 0.01;
const INITIAL_SEEK_TOLERANCE_SEC = 0.035;
const INITIAL_SEEK_END_PADDING_SEC = 0.05;
const INITIAL_SEEK_WATCHDOG_INTERVAL_MS = 120;

type UseSourceVideoSyncOptions = {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string | null;
  isPlaying: boolean;
  tempoRatio: number;
  offsetSec?: number;
  subscribe: (fn: (time: number) => void) => () => void;
  getCurrentTime: () => number;
};

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

function applyPlaybackRate(video: HTMLVideoElement, ratio: number): void {
  video.playbackRate = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, ratio));
}

function correctDrift(
  video: HTMLVideoElement,
  target: number,
  lastSyncRef: { current: number },
  mode: 'throttled' | 'aggressive',
): void {
  const now = performance.now();
  if (video.seeking || (mode === 'throttled' && video.readyState < video.HAVE_CURRENT_DATA)) {
    lastSyncRef.current = now;
    return;
  }

  const drift = Math.abs(video.currentTime - target);
  const tolerance = mode === 'aggressive' ? INITIAL_SEEK_TOLERANCE_SEC : DRIFT_CORRECT_SEC;
  if (drift <= tolerance) {
    return;
  }

  const shouldSnap = mode === 'aggressive' || now - lastSyncRef.current > DRIFT_THROTTLE_MS;

  if (shouldSnap) {
    lastSyncRef.current = now;
    video.currentTime = target;
  }
}

function clampSeekTarget(target: number, video: HTMLVideoElement): number {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Math.max(
      0,
      Math.min(target, Math.max(0, video.duration - INITIAL_SEEK_END_PADDING_SEC)),
    );
  }

  return Math.max(0, target);
}

/**
 * Waits for preroll before seeking, then keeps the initial frame hidden until
 * the seek completes. The watchdog also handles missed media events.
 */
function runInitialSeek(
  video: HTMLVideoElement,
  computeTarget: () => number,
  onReady: () => void,
): () => void {
  let finalized = false;
  let cleanup: (() => void) | undefined;

  const finalize = () => {
    if (finalized) {
      return;
    }
    finalized = true;
    onReady();
  };

  const start = () => {
    const target = computeTarget();

    if (target <= INITIAL_SEEK_SKIP_THRESHOLD_SEC) {
      finalize();
      return;
    }

    const seekTarget = clampSeekTarget(target, video);
    const isAligned = () => Math.abs(video.currentTime - seekTarget) <= INITIAL_SEEK_TOLERANCE_SEC;
    const tryFinalize = () => {
      const decoded = !video.seeking && video.readyState >= video.HAVE_CURRENT_DATA && isAligned();
      if (decoded) {
        finalize();
      }
      return decoded;
    };

    const watchdog = window.setInterval(() => {
      if (finalized) {
        return;
      }

      if (tryFinalize() || isAligned()) {
        return;
      }

      if (!video.seeking && video.readyState >= video.HAVE_FUTURE_DATA) {
        video.currentTime = seekTarget;
      }
    }, INITIAL_SEEK_WATCHDOG_INTERVAL_MS);

    video.addEventListener('seeked', tryFinalize);
    video.addEventListener('canplay', tryFinalize);
    video.currentTime = seekTarget;

    cleanup = () => {
      window.clearInterval(watchdog);
      video.removeEventListener('seeked', tryFinalize);
      video.removeEventListener('canplay', tryFinalize);
    };
  };

  const canStart = () =>
    Number.isFinite(video.duration) &&
    video.duration > 0 &&
    video.readyState >= video.HAVE_FUTURE_DATA;

  if (canStart()) {
    start();
  } else {
    const events = ['loadedmetadata', 'durationchange', 'canplay'] as const;
    const stopWaiting = () => {
      for (const event of events) {
        video.removeEventListener(event, onPreroll);
      }
    };
    const onPreroll = () => {
      if (!canStart()) {
        return;
      }

      stopWaiting();
      start();
    };

    for (const event of events) {
      video.addEventListener(event, onPreroll);
    }
    cleanup = stopWaiting;
  }

  return () => {
    finalized = true;
    cleanup?.();
  };
}

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
  const lastSyncRef = useRef(0);

  const isPlayingRef = useLatestRef(isPlaying);
  const inRangeRef = useRef(false);

  const currentRatio = useCallback(() => normalizeRatio(tempoRatio), [tempoRatio]);
  const toSourceTime = useCallback(
    (audioTime: number) => audioTime * currentRatio() + offsetSec,
    [currentRatio, offsetSec],
  );

  const synchronize = useCallback(
    (video: HTMLVideoElement, time: number, mode: 'throttled' | 'aggressive') => {
      const target = toSourceTime(time);
      const inRange = target >= 0 && (!Number.isFinite(video.duration) || target < video.duration);
      const entered = inRange && !inRangeRef.current;
      inRangeRef.current = inRange;
      setVisible(inRange);
      correctDrift(video, clampSeekTarget(target, video), lastSyncRef, mode);
      if (!inRange) {
        video.pause();
      } else if (entered && isPlayingRef.current) {
        safePlay(video);
      }
    },
    [isPlayingRef, toSourceTime],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof src !== 'string' || src === '') {
      return undefined;
    }

    readyRef.current = false;
    setReady(false);
    setVisible(false);
    inRangeRef.current = false;
    enforceSilent(video);
    applyPlaybackRate(video, currentRatio());

    return runInitialSeek(
      video,
      () => toSourceTime(getCurrentTime()),
      () => {
        readyRef.current = true;
        setReady(true);
        applyPlaybackRate(video, currentRatio());
        synchronize(video, getCurrentTime(), 'aggressive');
      },
    );
  }, [currentRatio, getCurrentTime, src, synchronize, toSourceTime, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !readyRef.current) {
      return;
    }

    enforceSilent(video);
    applyPlaybackRate(video, currentRatio());

    if (isPlaying && inRangeRef.current) {
      safePlay(video);
    } else {
      video.pause();
    }
  }, [currentRatio, isPlaying, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    applyPlaybackRate(video, currentRatio());
    if (!readyRef.current) {
      return;
    }

    synchronize(video, getCurrentTime(), 'aggressive');
  }, [currentRatio, getCurrentTime, synchronize, videoRef]);

  useEffect(() => {
    return subscribe((time) => {
      const video = videoRef.current;
      if (!video || !readyRef.current) {
        return;
      }

      synchronize(video, time, 'throttled');
    });
  }, [subscribe, synchronize, videoRef]);

  return { ready, visible };
}
