import { useCallback, useEffect, useRef, useState } from 'react';

export function usePreviewAudio(src: string | undefined, volume: number) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const subscribers = useRef(new Set<(time: number) => void>());
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const getCurrentTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);
  const subscribe = useCallback((subscriber: (value: number) => void) => {
    subscribers.current.add(subscriber);
    return () => {
      subscribers.current.delete(subscriber);
    };
  }, []);

  useEffect(() => {
    if (src === undefined) {
      return undefined;
    }
    const audio = new Audio(src);
    audio.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    audio.preload = 'metadata';
    audioRef.current = audio;
    let frame = 0;
    const tick = () => {
      for (const subscriber of subscribers.current) {
        subscriber(audio.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    const onTime = () => setTime(audio.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => setError('The original song audio is unavailable.');
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onPause);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('error', onError);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onPause);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('error', onError);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
    };
  }, [src, volume]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
      setError(null);
    } catch {
      setError('Cannot play the local audio preview.');
    }
  };
  const seek = (delta: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) {
      return;
    }
    audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + delta));
    setTime(audio.currentTime);
    for (const subscriber of subscribers.current) {
      subscriber(audio.currentTime);
    }
  };
  return { playing, error, time, getCurrentTime, subscribe, toggle, seek };
}
