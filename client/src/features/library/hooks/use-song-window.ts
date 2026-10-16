import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useState } from 'react';

import { songKey } from '@/features/library/components/song/song-key';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import type { Song } from '@/types/Song';

type Direction = 'up' | 'down' | 'left' | 'right';

function gridTarget(index: number, direction: Direction, columns: number, count: number) {
  const column = index % columns;
  switch (direction) {
    case 'left':
      return column > 0 ? index - 1 : null;
    case 'right':
      return column + 1 < columns && index + 1 < count ? index + 1 : null;
    case 'up':
      return index >= columns ? index - columns : null;
    case 'down':
      return (Math.floor(index / columns) + 1) * columns < count
        ? Math.min(index + columns, count - 1)
        : null;
    default:
      throw new Error('Unsupported grid direction');
  }
}

export function useSongWindow(songs: readonly Song[], layout: 'table' | 'grid') {
  const { focus, scrollRef, scrollTopRef, actionsRef } = useMenuFocus();
  const focusRef = useLatestRef(focus);
  const [geometry, setGeometry] = useState({ columns: 1, header: 40, rem: 16, visible: false });

  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) {
      return undefined;
    }
    const header = container.querySelector<HTMLElement>('[data-song-window-header]');
    const measure = (): void => {
      if (container.clientWidth === 0 || container.clientHeight === 0) {
        setGeometry((previous) => (previous.visible ? { ...previous, visible: false } : previous));
        return;
      }
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      const columns =
        layout === 'table'
          ? 1
          : Math.max(1, Math.floor((container.clientWidth + rem / 4) / (18.75 * rem)));
      const height = layout === 'table' ? (header?.getBoundingClientRect().height ?? 40) : rem / 4;
      setGeometry((previous) =>
        previous.columns === columns &&
        previous.header === height &&
        previous.rem === rem &&
        previous.visible
          ? previous
          : { columns, header: height, rem, visible: true },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (header !== null) {
      observer.observe(header);
    }
    return () => observer.disconnect();
  }, [layout, scrollRef]);

  const getItemKey = useCallback(
    (index: number) => `${geometry.columns}:${songKey(songs[index * geometry.columns])}`,
    [geometry.columns, songs],
  );
  // oxlint-disable-next-line react/incompatible-library -- React Compiler is not enabled; virtualizer snapshots are read on every render.
  const virtualizer = useVirtualizer({
    enabled: geometry.visible,
    count: Math.ceil(songs.length / geometry.columns),
    getScrollElement: () => scrollRef.current,
    initialOffset: () => scrollTopRef.current,
    estimateSize: () => geometry.rem * (layout === 'table' ? 3.5 : 12.5),
    getItemKey,
    overscan: 6,
    paddingStart: geometry.header,
    paddingEnd: layout === 'grid' ? geometry.rem / 4 : 0,
    scrollPaddingStart: geometry.header,
  });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const selected = focusRef.current;
      if (
        geometry.visible &&
        selected.active &&
        selected.source === 'nav' &&
        selected.panel !== 'sidebar' &&
        !selected.actionsFocused
      ) {
        virtualizer.scrollToIndex(Math.floor(selected.songIndex / geometry.columns), {
          align: 'auto',
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    focusRef,
    geometry.columns,
    geometry.header,
    geometry.rem,
    geometry.visible,
    layout,
    virtualizer,
  ]);

  useEffect(() => {
    const actions = actionsRef.current;
    const scrollToSong = (index: number): void =>
      virtualizer.scrollToIndex(Math.floor(index / geometry.columns), { align: 'auto' });
    actions.scrollToSong = scrollToSong;
    actions.songGridTarget =
      layout === 'grid'
        ? (index, direction) => gridTarget(index, direction, geometry.columns, songs.length)
        : null;
    return () => {
      if (actions.scrollToSong === scrollToSong) {
        actions.scrollToSong = null;
        actions.songGridTarget = null;
      }
    };
  }, [actionsRef, geometry.columns, layout, songs.length, virtualizer]);

  const rows = virtualizer.getVirtualItems();
  const before = Math.max(0, (rows.at(0)?.start ?? geometry.header) - geometry.header);
  const after = Math.max(
    0,
    virtualizer.getTotalSize() -
      (rows.at(-1)?.end ?? geometry.header) -
      (layout === 'grid' ? geometry.rem / 4 : 0),
  );

  return { rows, before, after, columns: geometry.columns, measure: virtualizer.measureElement };
}
