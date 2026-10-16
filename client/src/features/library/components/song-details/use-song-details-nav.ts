import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';

import { getDetailsFocusables, getNavigationRows, type NavigationRow } from './nav-dom';

function positionForIndex(rows: readonly NavigationRow[], target: number) {
  let offset = 0;
  for (const [segment, row] of rows.entries()) {
    if (target < offset + row.size) {
      return { segment, slot: target - offset };
    }
    offset += row.size;
  }
  return { segment: 0, slot: 0 };
}

export function useSongDetailsNav(onClose: () => void, covered = false) {
  const { focus, setFocus, actionsRef } = useMenuFocus();
  const { mode } = useDialog();
  const detailsRef = useRef<HTMLElement>(null);
  const initialFocusAppliedRef = useRef(false);
  const [navigationRows, setNavigationRows] = useState<NavigationRow[]>([
    { size: 1, horizontal: false },
  ]);

  const closeDetails = () => {
    setFocus((previous) => ({
      ...previous,
      active: true,
      panel: 'songList',
      source: 'nav',
    }));
    onClose();
  };

  const detailsPanelOpen = mode === null && focus.panel === 'songDetails' && !covered;
  const navigationStops = useMemo(() => navigationRows.map((row) => row.size), [navigationRows]);
  const focusableCount = useMemo(
    () => navigationRows.reduce((total, row) => total + row.size, 0),
    [navigationRows],
  );

  const { focusedIndex, focusSegment } = useDialogNav({
    open: detailsPanelOpen,
    itemCount: focusableCount,
    stops: navigationStops,
    containerRef: detailsRef,
    resetOnOpen: false,
    onBack: closeDetails,
    onAction: (segment, slot, action) => {
      setFocus((previous) => ({ ...previous, active: true, source: 'nav' }));

      const horizontalRow = navigationRows[segment]?.horizontal ?? false;
      if (horizontalRow && action.right) {
        return false;
      }
      if (horizontalRow && action.left && slot > 0) {
        return false;
      }

      if (action.left) {
        setFocus((previous) => ({
          ...previous,
          active: true,
          panel: 'songList',
          source: 'nav',
        }));
        if (!window.matchMedia('(min-width: 1280px)').matches) {
          onClose();
        }
        return true;
      }

      return action.right;
    },
  });

  useEffect(() => {
    const actions = actionsRef.current;
    actions.hasSongDetails = true;

    return () => {
      actions.hasSongDetails = false;
      setFocus((previous) => {
        if (previous.panel !== 'songDetails') {
          return previous;
        }
        return { ...previous, panel: 'songList', active: true, source: 'nav' };
      });
    };
  }, [actionsRef, setFocus]);

  useLayoutEffect(() => {
    const nextRows = getNavigationRows(getDetailsFocusables(detailsRef.current));
    setNavigationRows((currentRows) => {
      const unchanged =
        currentRows.length === nextRows.length &&
        currentRows.every(
          (row, index) =>
            row.size === nextRows[index].size && row.horizontal === nextRows[index].horizontal,
        );
      return unchanged ? currentRows : nextRows;
    });
  }, []);

  useLayoutEffect(() => {
    if (!detailsPanelOpen || initialFocusAppliedRef.current) {
      return;
    }

    const focusables = getDetailsFocusables(detailsRef.current);
    const measuredCount = navigationRows.reduce((total, row) => total + row.size, 0);
    if (focusables.length === 0 || measuredCount !== focusables.length) {
      return;
    }

    const playIndex = focusables.findIndex((element) =>
      element.hasAttribute('data-song-details-primary'),
    );
    const targetIndex = playIndex >= 0 ? playIndex : Math.min(1, focusables.length - 1);
    const { segment, slot } = positionForIndex(navigationRows, targetIndex);
    focusSegment(segment, slot);
    initialFocusAppliedRef.current = true;
  }, [detailsPanelOpen, focusSegment, navigationRows]);

  useEffect(() => {
    const focusables = getDetailsFocusables(detailsRef.current);
    focusables.forEach((element) => delete element.dataset.songDetailsFocused);
    if (!focus.active || !detailsPanelOpen) {
      return;
    }

    const target = focusables.at(focusedIndex);
    if (!target) {
      return;
    }
    target.dataset.songDetailsFocused = 'true';
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
  }, [detailsPanelOpen, focus.active, focusedIndex]);

  return { detailsRef, closeDetails };
}
