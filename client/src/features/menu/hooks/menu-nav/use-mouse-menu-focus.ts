import { useEffect } from 'react';

import {
  blurActiveTextInput,
  getHoveredActionsIndex,
  getHoveredSidebarIndex,
  getHoveredSidebarSubTarget,
  getHoveredSongIndex,
} from './dom';
import type { MenuNavHookOptions } from './types';

type SetMenuFocus = MenuNavHookOptions['menuFocus']['setFocus'];
type PointerPosition = { x: number; y: number };

function hasPointerMoved(event: PointerEvent, previous: PointerPosition | null): boolean {
  return (
    event.movementX !== 0 ||
    event.movementY !== 0 ||
    (previous !== null && (event.clientX !== previous.x || event.clientY !== previous.y))
  );
}

function focusSidebarSub(setFocus: SetMenuFocus, sidebarIndex: number, sidebarSubIndex: number) {
  setFocus((prev) => {
    if (
      prev.active &&
      prev.panel === 'sidebar' &&
      prev.sidebarIndex === sidebarIndex &&
      prev.sidebarSubIndex === sidebarSubIndex &&
      prev.source === 'mouse'
    ) {
      return prev;
    }

    return {
      ...prev,
      active: true,
      panel: 'sidebar',
      sidebarIndex,
      sidebarSubIndex,
      actionsFocused: false,
      source: 'mouse',
    };
  });
}

function focusSidebarRow(setFocus: SetMenuFocus, sidebarIndex: number) {
  setFocus((prev) => {
    if (
      prev.active &&
      prev.panel === 'sidebar' &&
      prev.sidebarIndex === sidebarIndex &&
      prev.source === 'mouse'
    ) {
      return prev;
    }

    const subReset = prev.sidebarIndex !== sidebarIndex ? { sidebarSubIndex: 0 } : null;
    return {
      ...prev,
      ...subReset,
      active: true,
      panel: 'sidebar',
      sidebarIndex,
      actionsFocused: false,
      source: 'mouse',
    };
  });
}

function focusActions(setFocus: SetMenuFocus, actionsIndex: number) {
  setFocus((prev) => {
    if (
      prev.active &&
      prev.panel === 'songList' &&
      prev.actionsFocused &&
      prev.actionsIndex === actionsIndex &&
      prev.source === 'mouse'
    ) {
      return prev;
    }

    return {
      ...prev,
      active: true,
      panel: 'songList',
      actionsFocused: true,
      actionsIndex,
      source: 'mouse',
    };
  });
}

function focusSong(setFocus: SetMenuFocus, songIndex: number) {
  setFocus((prev) => {
    if (
      prev.active &&
      prev.panel === 'songList' &&
      !prev.actionsFocused &&
      prev.songIndex === songIndex &&
      prev.source === 'mouse'
    ) {
      return prev;
    }

    return {
      ...prev,
      active: true,
      panel: 'songList',
      songIndex,
      actionsFocused: false,
      source: 'mouse',
    };
  });
}

export function useMouseMenuFocus({ menuFocus, refs, lock }: MenuNavHookOptions) {
  const { setFocus } = menuFocus;

  useEffect(() => {
    let lastPosition: PointerPosition | null = null;

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') {
        return;
      }

      const moved = hasPointerMoved(event, lastPosition);
      lastPosition = { x: event.clientX, y: event.clientY };
      if (!moved || lock.isLocked() || refs.overlayOpenRef.current) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const subTarget = getHoveredSidebarSubTarget(target);
      if (subTarget) {
        blurActiveTextInput();
        focusSidebarSub(setFocus, subTarget.sidebarIndex, subTarget.sidebarSubIndex);
        return;
      }

      const sidebarIndex = getHoveredSidebarIndex(target);
      if (sidebarIndex !== null) {
        blurActiveTextInput();
        focusSidebarRow(setFocus, sidebarIndex);
        return;
      }

      const actionsIndex = getHoveredActionsIndex(target);
      if (actionsIndex !== null) {
        blurActiveTextInput();
        focusActions(setFocus, actionsIndex);
        return;
      }

      const songIndex = getHoveredSongIndex(target);
      if (songIndex !== null) {
        blurActiveTextInput();
        focusSong(setFocus, songIndex);
        return;
      }

      setFocus((prev) =>
        prev.active || prev.source !== 'mouse' ? { ...prev, active: false, source: 'mouse' } : prev,
      );
    };

    window.addEventListener('pointermove', onPointerMove);
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [lock, refs, setFocus]);
}
