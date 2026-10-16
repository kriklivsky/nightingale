import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PlaybackQueueEntry } from '@/bridge/playback-queue';
import { canDeleteLocalFiles } from '@/bridge/songs';
import { useFavoriteHashes, useSetSongFavorite } from '@/features/library/hooks/use-favorites';
import { useAnalysisQueue, useSongs } from '@/features/library/queries/use-songs';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { useSearch } from '@/features/menu/hooks/use-search';
import { useMenuFocus, type MenuFocus } from '@/features/menu/providers/menu-focus-context';
import { QueueSidebar } from '@/features/playback-queue/components/queue-sidebar';
import { usePlaybackQueueQuery } from '@/features/playback-queue/use-playback-queue';
import { usePlaybackLauncher } from '@/features/playback/hooks/use-playback-launcher';
import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import { useConfig } from '@/shared/config/use-config';
import { useConfigMutation } from '@/shared/config/use-config-mutation';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { usePersistentScroll } from '@/shared/hooks/use-persistent-scroll';
import { cn } from '@/shared/utils/cn';
import type { AppConfig } from '@/types/AppConfig';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';
import type { SongSort } from '@/types/SongSort';
import type { SongSortColumn } from '@/types/SongSortColumn';

import { LibraryProgress } from './library-progress';
import { LibraryToolbar, type SongListView } from './library-toolbar';
import { SongDetailsSidebar } from './song-details/song-details-sidebar';
import { SongList } from './song-list/song-list';
import type { SongItemProps } from './song-list/types';
import { songKey } from './song/song-key';
import { getSongStatusInfo } from './song/song-status';

const hasFilters = (values: readonly unknown[]): boolean =>
  values.some((value) => (typeof value === 'string' ? value.trim() !== '' : Boolean(value)));

const songListSort = (config: AppConfig | undefined): readonly SongSort[] =>
  config?.song_list_sort ?? [];

const nextSongSort = (sorts: readonly SongSort[], column: SongSortColumn): SongSort[] | null => {
  const sortIndex = sorts.findIndex((sort) => sort.column === column);
  if (sortIndex === -1) {
    return [...sorts, { column, direction: 'ascending' }];
  }
  if (sorts[sortIndex].direction === 'ascending') {
    return sorts.map((sort, index) =>
      index === sortIndex ? { ...sort, direction: 'descending' } : sort,
    );
  }

  const nextSorts = sorts.filter((_, index) => index !== sortIndex);
  return nextSorts.length === 0 ? null : nextSorts;
};

function SongLoadError({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  const { focus } = useMenuFocus();
  const focused =
    focus.active && focus.panel === 'songList' && focus.actionsFocused && focus.actionsIndex === 8;

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border border-destructive p-3"
    >
      <p>Could not load songs. Try again.</p>
      <Button
        variant="outline"
        data-actions-index="8"
        className={cn(focused && 'ring-2 ring-primary')}
        onClick={onRetry}
        disabled={retrying}
      >
        Retry
      </Button>
    </div>
  );
}

type SongSidePanelProps = {
  queueOpen: boolean;
  playbackQueue: PlaybackQueueEntry[];
  song: Song | null;
  queueEntries?: Record<string, QueuedStatus>;
  onCloseQueue: () => void;
  onCloseSong: () => void;
};

function SongSidePanel({
  queueOpen,
  playbackQueue,
  song,
  queueEntries,
  onCloseQueue,
  onCloseSong,
}: SongSidePanelProps) {
  if (queueOpen) {
    return (
      <QueueSidebar key={playbackQueue.length} entries={playbackQueue} onClose={onCloseQueue} />
    );
  }
  if (song) {
    return (
      <SongDetailsSidebar
        key={songKey(song)}
        song={song}
        queueStatus={queueEntries?.[song.file_hash]}
        onClose={onCloseSong}
      />
    );
  }
  return null;
}

const songListPaneClass = (song: Song | null, queueOpen: boolean): string =>
  song || queueOpen ? 'hidden xl:flex' : 'flex';

function RemoteNavigationGuide({ focus }: { focus: MenuFocus }) {
  if (!focus.active || focus.source !== 'nav') {
    return null;
  }

  let instructions = '↑↓ Songs · → Song actions · OK Details · ← Library';
  if (focus.panel === 'sidebar') {
    instructions = '↑↓ Browse library · ←→ Sections and panels · OK Select';
  } else if (focus.panel === 'songDetails') {
    instructions = '↑↓ Options · ←→ Adjust or move · OK Select · Back Songs';
  } else if (focus.actionsFocused) {
    instructions = '←→ Search, filters and tools · ↓ Songs · OK Select';
  } else if (focus.songActionIndex !== null) {
    instructions = '←→ Favorite, Play, Delete · ↑↓ Songs · OK Select';
  }

  return (
    <div className="shrink-0 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
      <span className="mr-2 font-semibold text-foreground">Remote</span>
      {instructions}
    </div>
  );
}

export const Library = () => {
  const { data: queue } = useAnalysisQueue();
  const { setMode } = useDialog();
  const { data: favoriteHashes = [] } = useFavoriteHashes();
  const { mutate: setFavorite, isLoading: isSavingFavorite } = useSetSongFavorite();
  const { launch, reserveTarget } = usePlaybackLauncher();
  const { data: playbackQueue = [] } = usePlaybackQueueQuery();
  const { data: config } = useConfig();
  const { mutate: saveConfig, isPending: isSavingConfig } = useConfigMutation();
  const { focus, actionsRef, setFocus, selectedSong, setSelectedSong } = useMenuFocus();
  const { setScrollContainer, resetScroll } = usePersistentScroll('songList', false);
  const { search } = useSearch();
  const { artist, album, playlist, folder, query, status, transcript_source } = useLibraryFilter();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useSongs();
  const [queueOpen, setQueueOpen] = useState(false);
  const view: SongListView = config?.song_list_view === 'grid' ? 'grid' : 'table';
  const sort = songListSort(config);
  const songs = useMemo(() => data?.pages.flatMap((page) => page.processed) ?? [], [data]);
  const favoriteSet = useMemo(() => new Set(favoriteHashes), [favoriteHashes]);
  const selectedKey = selectedSong && songKey(selectedSong);
  const currentSelectedSong = songs.find((song) => songKey(song) === selectedKey) ?? selectedSong;
  const filterKey = JSON.stringify([
    search,
    artist,
    album,
    playlist,
    folder,
    query,
    status,
    transcript_source,
    sort,
  ]);
  const previousFilterKeyRef = useRef(filterKey);
  const songsRef = useLatestRef(songs);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (previousFilterKeyRef.current === filterKey) {
      return;
    }
    previousFilterKeyRef.current = filterKey;

    resetScroll();
    setFocus((previous) => ({ ...previous, songIndex: 0, songActionIndex: null }));
  }, [filterKey, resetScroll, setFocus]);

  useEffect(() => {
    actionsRef.current.songCount = songs.length;
  }, [songs.length, actionsRef]);

  const toggleFavorite = useCallback(
    (song: Song) => {
      if (!isSavingFavorite) {
        setFavorite({ fileHash: song.file_hash, favorite: !favoriteSet.has(song.file_hash) });
      }
    },
    [favoriteSet, isSavingFavorite, setFavorite],
  );

  const playSong = useCallback(
    (song: Song) => {
      if (getSongStatusInfo(song.is_analyzed, queue?.entries[song.file_hash]).isReady !== true) {
        return;
      }
      const target = reserveTarget();
      if (target !== undefined) {
        void launch({ song, queuePlayback: false }, target);
      }
    },
    [launch, queue, reserveTarget],
  );

  const canDeleteSong = useCallback(
    (song: Song) => {
      const analysisStatus = queue?.entries[song.file_hash];
      return (
        canDeleteLocalFiles &&
        song.origin.kind === 'local_file' &&
        analysisStatus !== 'Queued' &&
        (typeof analysisStatus !== 'object' || !('Analyzing' in analysisStatus))
      );
    },
    [queue],
  );

  const deleteSong = useCallback(
    (song: Song) => {
      if (canDeleteSong(song)) {
        setMode({ mode: 'delete-song', song });
      }
    },
    [canDeleteSong, setMode],
  );

  useEffect(() => {
    const actions = actionsRef.current;
    actions.onConfirmSong = (index: number) => {
      const song = songsRef.current.at(index);
      if (!song) {
        return;
      }

      setQueueOpen(false);
      setSelectedSong(song);
      setFocus((previous) => ({
        ...previous,
        active: true,
        panel: 'songDetails',
        songActionIndex: null,
        source: 'nav',
      }));
    };
    actions.onConfirmSongAction = (songIndex: number, actionIndex: number) => {
      const song = songsRef.current.at(songIndex);
      if (!song) {
        return;
      }
      if (actionIndex === 0) {
        toggleFavorite(song);
      } else if (actionIndex === 1) {
        playSong(song);
      } else if (actionIndex === 2) {
        deleteSong(song);
      }
    };
    return () => {
      actions.onConfirmSong = null;
      actions.onConfirmSongAction = null;
    };
  }, [actionsRef, deleteSong, playSong, setFocus, setSelectedSong, songsRef, toggleFavorite]);

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage === true && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const isSongListActive = focus.active && focus.panel === 'songList';
  const hasActiveFilter = hasFilters([
    search,
    artist,
    album,
    playlist,
    folder,
    query,
    status,
    transcript_source,
  ]);
  const selectSong = useCallback(
    (song: Song) => {
      setQueueOpen(false);
      setSelectedSong(song);
    },
    [setSelectedSong],
  );
  const openQueue = () => {
    setSelectedSong(null);
    setQueueOpen(true);
    setFocus((previous) => ({ ...previous, active: true, panel: 'songDetails' }));
  };
  const sortSongs = (column: SongSortColumn) => {
    saveConfig({ song_list_sort: nextSongSort(sort, column) });
  };

  const getItemProps = (song: (typeof songs)[number], index: number): SongItemProps => ({
    song,
    queueStatus: queue?.entries[song.file_hash],
    index,
    isSelected: selectedKey === songKey(song),
    isFocused: isSongListActive && !focus.actionsFocused && focus.songIndex === index,
    isFavorite: favoriteSet.has(song.file_hash),
    focusedAction:
      isSongListActive && !focus.actionsFocused && focus.songIndex === index
        ? focus.songActionIndex
        : null,
    canPlay: getSongStatusInfo(song.is_analyzed, queue?.entries[song.file_hash]).isReady === true,
    canDelete: canDeleteSong(song),
    onSelect: selectSong,
    onToggleFavorite: toggleFavorite,
    onPlay: playSong,
    onDelete: deleteSong,
  });

  return (
    <div className="flex min-h-0 w-full flex-1 overflow-hidden">
      <main
        className={cn(
          'min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4',
          songListPaneClass(currentSelectedSong, queueOpen),
        )}
      >
        <LibraryToolbar
          view={view}
          sort={sort}
          queueCount={playbackQueue.length}
          isSavingView={isSavingConfig}
          onOpenQueue={openQueue}
          onViewChange={(nextView) => saveConfig({ song_list_view: nextView })}
          onSortChange={(nextSort) => saveConfig({ song_list_sort: nextSort })}
        />
        <Separator />
        <LibraryProgress />
        {isError && <SongLoadError retrying={isFetching} onRetry={() => void refetch()} />}
        <SongList
          songs={songs}
          view={view}
          sort={sort}
          sortingDisabled={isSavingConfig}
          loading={isLoading}
          failed={isError}
          hasActiveFilter={hasActiveFilter}
          getItemProps={getItemProps}
          setScrollContainer={setScrollContainer}
          sentinelRef={sentinelRef}
          onSort={sortSongs}
        />
        <RemoteNavigationGuide focus={focus} />
      </main>

      <SongSidePanel
        queueOpen={queueOpen}
        playbackQueue={playbackQueue}
        song={currentSelectedSong}
        queueEntries={queue?.entries}
        onCloseQueue={() => setQueueOpen(false)}
        onCloseSong={() => setSelectedSong(null)}
      />
    </div>
  );
};
