import { useCallback } from 'react';

import type { NavAction } from '@/app/providers/nav-input-context';
import type { MenuFocus } from '@/features/menu/providers/menu-focus-context';

import { useNavInput } from '../use-nav-input';
import {
  blurActiveTextInput,
  getActionsCount,
  getActionTarget,
  getSongGridTarget,
  isSongGrid,
  type SongGridDirection,
} from './dom';
import type { MenuNavHookOptions } from './types';

const CONFIRM_COOLDOWN_MS = 140;

type UseMenuNavInputOptions = {
  scrollToSong: (index: number) => void;
} & MenuNavHookOptions;

function hasInput(action: NavAction): boolean {
  return action.up || action.down || action.left || action.right || action.confirm || action.back;
}

export function useMenuNavInput({ menuFocus, refs, lock, scrollToSong }: UseMenuNavInputOptions) {
  const { activate, actionsRef } = menuFocus;

  useNavInput(
    useCallback(
      (action) => {
        const handleBack = (): boolean => {
          if (!action.back) {
            return false;
          }
          const handled = actionsRef.current.onSidebarBack?.();
          if (handled !== true) {
            refs.onBackRef.current();
          }
          return true;
        };

        const handleDirectionalInput = (): void => {
          if (handleSongNavigation(action, menuFocus, scrollToSong)) {
            return;
          }
          if ((action.left || action.right) && handleActionsHorizontal(action, menuFocus)) {
            return;
          }
          if ((action.left || action.right) && handleHorizontalAction(action, menuFocus)) {
            return;
          }
          if (action.up || action.down) {
            handleVerticalAction(action, menuFocus, scrollToSong);
          }
        };

        const ignoreInput =
          refs.overlayOpenRef.current ||
          !hasInput(action) ||
          menuFocus.focus.panel === 'songDetails';
        if (ignoreInput || handleBack()) {
          return;
        }

        if (actionsRef.current.isSidebarBusy?.() === true) {
          return;
        }

        blurActiveTextInput();
        activate();
        lock.lockTemporarily();

        if (action.confirm) {
          handleConfirmAction(menuFocus, refs);
          return;
        }

        handleDirectionalInput();
      },
      [actionsRef, activate, lock, menuFocus, refs, scrollToSong],
    ),
  );
}

function confirmFocusedAction(
  actionsRef: MenuNavHookOptions['menuFocus']['actionsRef'],
  index: number,
): void {
  if (actionsRef.current.onConfirmActions?.(index) !== true) {
    getActionTarget(index)?.click();
  }
}

function handleConfirmAction(
  { actionsRef, focus }: Pick<MenuNavHookOptions['menuFocus'], 'actionsRef' | 'focus'>,
  refs: MenuNavHookOptions['refs'],
) {
  const now = performance.now();
  if (!focus.active) {
    return;
  }
  if (now - refs.lastConfirmAtRef.current < CONFIRM_COOLDOWN_MS) {
    return;
  }
  refs.lastConfirmAtRef.current = now;

  if (focus.panel === 'songList') {
    if (focus.actionsFocused) {
      confirmFocusedAction(actionsRef, focus.actionsIndex);
    } else if (focus.songActionIndex !== null) {
      actionsRef.current.onConfirmSongAction?.(focus.songIndex, focus.songActionIndex);
    } else {
      actionsRef.current.onConfirmSong?.(focus.songIndex);
    }
    return;
  }

  if (focus.panel === 'sidebar') {
    actionsRef.current.onConfirmSidebar?.(focus.sidebarIndex);
  }
}

function handleSongNavigation(
  action: NavAction,
  menuFocus: MenuNavHookOptions['menuFocus'],
  scrollToSong: (index: number) => void,
): boolean {
  return (
    handleSongRowActionNavigation(action, menuFocus, scrollToSong) ||
    handleSongGridAction(action, menuFocus, scrollToSong)
  );
}

function nextSongActionIndex(current: number | null, right: boolean): number | null {
  if (right) {
    return Math.min(2, (current ?? -1) + 1);
  }
  return current === 0 ? null : 0;
}

function moveToNextGridSong(
  container: HTMLElement,
  songIndex: number,
  setFocus: MenuNavHookOptions['menuFocus']['setFocus'],
  scrollToSong: (index: number) => void,
): void {
  const nextIndex = getSongGridTarget(container, songIndex, 'right');
  if (nextIndex === null) {
    return;
  }

  setFocus((previous) => ({
    ...previous,
    songIndex: nextIndex,
    songActionIndex: null,
    active: true,
    source: 'nav',
  }));
  scrollToSong(nextIndex);
}

function handleSongRowActionNavigation(
  action: NavAction,
  {
    focus,
    scrollRef,
    setFocus,
  }: Pick<MenuNavHookOptions['menuFocus'], 'focus' | 'scrollRef' | 'setFocus'>,
  scrollToSong: (index: number) => void,
): boolean {
  if (focus.panel !== 'songList' || focus.actionsFocused || (!action.left && !action.right)) {
    return false;
  }

  if (focus.songActionIndex === null && !action.right) {
    return false;
  }

  if (focus.songActionIndex === 2 && action.right && isSongGrid(scrollRef.current)) {
    moveToNextGridSong(scrollRef.current, focus.songIndex, setFocus, scrollToSong);
    return true;
  }

  setFocus((previous) => ({
    ...previous,
    songActionIndex: nextSongActionIndex(previous.songActionIndex, action.right),
    active: true,
    source: 'nav',
  }));
  return true;
}

function getGridDirection(action: NavAction): SongGridDirection | null {
  if (action.up) {
    return 'up';
  }
  if (action.down) {
    return 'down';
  }
  if (action.left) {
    return 'left';
  }
  if (action.right) {
    return 'right';
  }
  return null;
}

function handleSongGridAction(
  action: NavAction,
  {
    focus,
    scrollRef,
    setFocus,
  }: Pick<MenuNavHookOptions['menuFocus'], 'focus' | 'scrollRef' | 'setFocus'>,
  scrollToSong: (index: number) => void,
): boolean {
  const direction = getGridDirection(action);
  const container = scrollRef.current;
  if (!direction || focus.panel !== 'songList' || focus.actionsFocused || !isSongGrid(container)) {
    return false;
  }

  const targetIndex = getSongGridTarget(container, focus.songIndex, direction);
  if (targetIndex !== null) {
    setFocus((previous) => ({
      ...previous,
      active: true,
      songIndex: targetIndex,
      actionsFocused: false,
      songActionIndex: previous.songActionIndex,
      source: 'nav',
    }));
    scrollToSong(targetIndex);
    return true;
  }

  setFocus((previous) => {
    let panel = previous.panel;
    let actionsFocused = false;

    if (direction === 'left') {
      panel = 'sidebar';
    } else if (direction === 'up') {
      actionsFocused = true;
    }

    return {
      ...previous,
      active: true,
      panel,
      actionsFocused,
      songActionIndex: null,
      source: 'nav',
    };
  });
  return true;
}

function handleActionsHorizontal(
  action: NavAction,
  {
    focus,
    actionsRef,
    setFocus,
  }: Pick<MenuNavHookOptions['menuFocus'], 'focus' | 'actionsRef' | 'setFocus'>,
): boolean {
  if (focus.panel !== 'songList' || !focus.actionsFocused) {
    return false;
  }

  const lastIndex = Math.max(0, getActionsCount() - 1);
  setFocus((previous) => {
    if (action.left && previous.actionsIndex > 0) {
      return { ...previous, actionsIndex: previous.actionsIndex - 1, source: 'nav' };
    }
    if (action.right && previous.actionsIndex < lastIndex) {
      return { ...previous, actionsIndex: previous.actionsIndex + 1, source: 'nav' };
    }

    let panel = previous.panel;
    if (action.left) {
      panel = 'sidebar';
    } else if (actionsRef.current.hasSongDetails) {
      panel = 'songDetails';
    }

    return {
      ...previous,
      panel,
      actionsFocused: false,
      source: 'nav',
    };
  });
  return true;
}

type SetMenuFocus = MenuNavHookOptions['menuFocus']['setFocus'];

function focusSidebarIndex(setFocus: SetMenuFocus, sidebarIndex: number): void {
  setFocus((previous) => ({
    ...previous,
    sidebarIndex,
    active: true,
    source: 'nav',
  }));
}

function toggleSidebarSection(
  action: NavAction,
  target: HTMLElement,
  setFocus: SetMenuFocus,
): boolean {
  const expanded = target.getAttribute('aria-expanded');
  if ((action.right && expanded === 'false') || (action.left && expanded === 'true')) {
    setFocus((previous) => ({ ...previous, active: true, source: 'nav' }));
    target.click();
    return true;
  }

  return false;
}

function enterSidebarSection(
  action: NavAction,
  target: HTMLElement,
  sidebarIndex: number,
  setFocus: SetMenuFocus,
): boolean {
  if (!action.right || target.getAttribute('aria-expanded') !== 'true') {
    return false;
  }

  const firstChild = document.querySelector<HTMLElement>(
    `[data-sidebar-parent-index="${sidebarIndex}"]`,
  );
  const childIndex = Number(firstChild?.dataset.sidebarNavIndex);
  if (!firstChild || !Number.isInteger(childIndex)) {
    return false;
  }

  focusSidebarIndex(setFocus, childIndex);
  return true;
}

function returnToSidebarParent(
  action: NavAction,
  target: HTMLElement,
  setFocus: SetMenuFocus,
): boolean {
  const parentIndex = target.dataset.sidebarParentIndex;
  if (!action.left || parentIndex === undefined) {
    return false;
  }

  const index = Number(parentIndex);
  if (!Number.isInteger(index)) {
    return false;
  }

  focusSidebarIndex(setFocus, index);
  return true;
}

function handleSidebarHierarchy(
  action: NavAction,
  { focus, setFocus }: Pick<MenuNavHookOptions['menuFocus'], 'focus' | 'setFocus'>,
): boolean {
  if (focus.panel !== 'sidebar') {
    return false;
  }

  const target = document.querySelector<HTMLElement>(
    `[data-sidebar-nav-index="${focus.sidebarIndex}"]`,
  );
  if (!target) {
    return false;
  }

  return (
    toggleSidebarSection(action, target, setFocus) ||
    enterSidebarSection(action, target, focus.sidebarIndex, setFocus) ||
    returnToSidebarParent(action, target, setFocus)
  );
}

function handleHorizontalAction(
  action: NavAction,
  {
    focus,
    actionsRef,
    setFocus,
  }: Pick<MenuNavHookOptions['menuFocus'], 'focus' | 'actionsRef' | 'setFocus'>,
): boolean {
  if (focus.panel === 'sidebar') {
    const subCount = actionsRef.current.sidebarSubCountByIndex.get(focus.sidebarIndex);
    if (typeof subCount === 'number' && subCount > 1) {
      const delta = action.left ? -1 : 1;
      const nextSub = Math.max(0, Math.min(subCount - 1, focus.sidebarSubIndex + delta));
      if (nextSub !== focus.sidebarSubIndex) {
        setFocus((previous) => ({
          ...previous,
          sidebarSubIndex: nextSub,
          active: true,
          source: 'nav',
        }));
        return true;
      }
      if (action.left) {
        return true;
      }
    }
  }

  if (handleSidebarHierarchy(action, { focus, setFocus })) {
    return true;
  }

  if (action.left) {
    setFocus((prev) => ({
      ...prev,
      panel: prev.panel === 'songList' ? 'sidebar' : prev.panel,
      actionsFocused: false,
      songActionIndex: null,
      active: true,
      source: 'nav',
    }));
    return true;
  }

  setFocus((prev) => {
    let panel = prev.panel;
    if (prev.panel === 'sidebar') {
      panel = 'songList';
    } else if (prev.panel === 'songList' && actionsRef.current.hasSongDetails) {
      panel = 'songDetails';
    }

    return {
      ...prev,
      panel,
      actionsFocused: false,
      songActionIndex: null,
      active: true,
      source: 'nav',
    };
  });
  return true;
}

type SongListMove = {
  next: MenuFocus;
  previous: MenuFocus;
  action: NavAction;
  songCount: number;
  scrollToSong: (index: number) => void;
};

function moveSongListFocus(move: SongListMove): void {
  if (move.previous.actionsFocused) {
    if (move.action.down) {
      move.next.actionsFocused = false;
      move.next.songIndex = 0;
      move.next.songActionIndex = null;
      move.scrollToSong(0);
    }
    return;
  }
  if (move.action.up) {
    move.next.actionsFocused = move.previous.songIndex <= 0;
    move.next.songIndex = Math.max(0, move.previous.songIndex - 1);
    if (move.next.actionsFocused) {
      move.next.songActionIndex = null;
    }
    move.scrollToSong(move.next.songIndex);
    return;
  }
  if (move.action.down && move.previous.songIndex < move.songCount - 1) {
    move.next.songIndex = move.previous.songIndex + 1;
    move.scrollToSong(move.next.songIndex);
  }
}

function moveSidebarFocus(
  next: MenuFocus,
  previous: MenuFocus,
  action: NavAction,
  sidebarCount: number,
): void {
  if (sidebarCount <= 0) {
    next.sidebarIndex = 0;
    next.sidebarSubIndex = 0;
    return;
  }
  if (action.up) {
    next.sidebarIndex = Math.max(0, previous.sidebarIndex - 1);
  } else if (action.down) {
    next.sidebarIndex = Math.min(sidebarCount - 1, previous.sidebarIndex + 1);
  }
  next.sidebarSubIndex = 0;
}

function handleVerticalAction(
  action: NavAction,
  { actionsRef, setFocus }: Pick<MenuNavHookOptions['menuFocus'], 'actionsRef' | 'setFocus'>,
  scrollToSong: (index: number) => void,
) {
  setFocus((prev) => {
    const next = { ...prev, active: true, source: 'nav' as const };

    if (prev.panel === 'songList') {
      moveSongListFocus({
        next,
        previous: prev,
        action,
        songCount: actionsRef.current.songCount,
        scrollToSong,
      });
    } else if (prev.panel === 'sidebar') {
      moveSidebarFocus(next, prev, action, actionsRef.current.sidebarCount);
    }

    return next;
  });
}
