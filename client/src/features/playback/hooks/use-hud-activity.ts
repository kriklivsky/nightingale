import { useCallback, useEffect, useRef, useState } from 'react';

import { useNavInput } from '@/features/menu/hooks/use-nav-input';

const HUD_IDLE_MS = 4000;
const IDLE_CHECK_MS = 500;

/**
 * True while the viewer recently interacted (remote, keyboard, gamepad,
 * pointer or touch). Secondary HUD details hide after a quiet period so the
 * lyrics and video stay unobstructed; `forceVisible` keeps them on screen.
 */
export function useHudActivity(forceVisible: boolean): boolean {
  const lastActivityRef = useRef(0);
  const [idle, setIdle] = useState(false);

  const wake = useCallback(() => {
    lastActivityRef.current = performance.now();
    setIdle(false);
  }, []);

  useNavInput(wake);

  useEffect(() => {
    window.addEventListener('keydown', wake);
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      window.removeEventListener('keydown', wake);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, [wake]);

  useEffect(() => {
    if (forceVisible) {
      return undefined;
    }
    lastActivityRef.current = performance.now();
    const timer = window.setInterval(() => {
      if (performance.now() - lastActivityRef.current >= HUD_IDLE_MS) {
        setIdle(true);
      }
    }, IDLE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [forceVisible]);

  return forceVisible || !idle;
}
