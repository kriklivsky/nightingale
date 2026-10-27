import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { NavInputContext } from '@/app/providers/nav-input-context';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

/** Menu inactivity before the screensaver appears. */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const IDLE_CHECK_MS = 5000;
/** The clock moves this often so no OLED pixels stay lit in one place. */
const MOVE_INTERVAL_MS = 60 * 1000;
const CLOCK_TICK_MS = 1000;
const FADE_MS = 1500;

type ClockPosition = { left: number; top: number };

/** Random position (percent of the viewport) that keeps the clock fully on screen. */
function randomPosition(): ClockPosition {
  return { left: 15 + Math.random() * 70, top: 15 + Math.random() * 70 };
}

/** Shows the screensaver after inactivity; any input dismisses it without reaching the menu. */
function useIdleScreensaver(): { active: boolean; dismiss: () => void } {
  const nav = useContext(NavInputContext);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const lastActivityRef = useRef(0);

  useEffect(() => {
    lastActivityRef.current = performance.now();
    const timer = window.setInterval(() => {
      if (!activeRef.current && performance.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) {
        activeRef.current = true;
        setActive(true);
      }
    }, IDLE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const dismiss = useCallback((): void => {
    lastActivityRef.current = performance.now();
    if (activeRef.current) {
      activeRef.current = false;
      setActive(false);
    }
  }, []);

  useEffect(() => {
    if (!nav) {
      return undefined;
    }
    return nav.intercept(() => {
      const wasActive = activeRef.current;
      dismiss();
      return wasActive;
    });
  }, [dismiss, nav]);

  useEffect(() => {
    const onActivity = (event: Event) => {
      if (activeRef.current && event.type === 'keydown') {
        event.preventDefault();
        event.stopPropagation();
      }
      dismiss();
    };
    const events = ['keydown', 'pointermove', 'pointerdown', 'wheel', 'touchstart'] as const;
    for (const type of events) {
      window.addEventListener(type, onActivity, { capture: true, passive: type !== 'keydown' });
    }
    return () => {
      for (const type of events) {
        window.removeEventListener(type, onActivity, { capture: true });
      }
    };
  }, [dismiss]);

  return { active, dismiss };
}

function useNow(enabled: boolean): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return now;
}

function useWanderingPosition(enabled: boolean): { position: ClockPosition; visible: boolean } {
  const [position, setPosition] = useState<ClockPosition>({ left: 50, top: 50 });
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let fadeTimer = 0;
    const timer = window.setInterval(() => {
      setVisible(false);
      fadeTimer = window.setTimeout(() => {
        setPosition(randomPosition());
        setVisible(true);
      }, FADE_MS);
    }, MOVE_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(fadeTimer);
    };
  }, [enabled]);

  return { position, visible };
}

/**
 * OLED-friendly menu screensaver: a dim clock on pure black that changes
 * position every minute. Playback has its own screen and never shows it.
 */
export function MenuScreensaver() {
  const { t, locale } = useI18n();
  const { active, dismiss } = useIdleScreensaver();
  const now = useNow(active);
  const { position, visible } = useWanderingPosition(active);

  if (!active) {
    return null;
  }

  return (
    <button
      type="button"
      aria-label={t('screensaver.dismiss')}
      onClick={dismiss}
      className="fixed inset-0 z-100 cursor-none bg-black outline-none"
    >
      <span
        className={cn(
          'absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 text-white/25 transition-opacity duration-1500 motion-reduce:transition-none',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        style={{ left: `${position.left}%`, top: `${position.top}%` }}
      >
        <time className="text-8xl font-extralight tabular-nums" dateTime={now.toISOString()}>
          {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
        </time>
        <span className="text-2xl font-light text-white/15">
          {now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </span>
    </button>
  );
}
