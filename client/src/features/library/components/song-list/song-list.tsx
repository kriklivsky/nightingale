import type { RefObject } from 'react';

import { useSongVideoHashes } from '@/features/song-video/queries';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { useI18n } from '@/shared/i18n/use-i18n';
import type { Song } from '@/types/Song';
import type { SongSort } from '@/types/SongSort';
import type { SongSortColumn } from '@/types/SongSortColumn';

import type { SongListView } from '../library-toolbar';
import type { SongItemProps } from './types';
import { SongGrid } from './views/song-grid';
import { SongTable } from './views/song-table';

type SongListProps = {
  songs: Song[];
  view: SongListView;
  sort: readonly SongSort[];
  sortingDisabled: boolean;
  loading: boolean;
  failed: boolean;
  hasActiveFilter: boolean;
  getItemProps: (song: Song, index: number) => SongItemProps;
  setScrollContainer: (element: HTMLElement | null) => void;
  sentinelRef: RefObject<HTMLDivElement | null>;
  onSort: (column: SongSortColumn) => void;
};

const EMPTY_VIDEO_HASHES: ReadonlySet<string> = new Set();

const EmptySongs = ({ filtered }: { filtered: boolean }) => {
  const { t } = useI18n();

  return (
    <Empty className="px-4">
      <EmptyHeader>
        <EmptyTitle>{filtered ? t('library.noResults') : t('library.noSongs')}</EmptyTitle>
        <EmptyDescription>
          {filtered ? t('library.noResultsDescription') : t('library.noSongsDescription')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
};

export const SongList = ({
  songs,
  view,
  sort,
  sortingDisabled,
  loading,
  failed,
  hasActiveFilter,
  getItemProps,
  setScrollContainer,
  sentinelRef,
  onSort,
}: SongListProps) => {
  const { t } = useI18n();
  const videos = useSongVideoHashes(songs.length > 0);
  if (songs.length === 0 && failed) {
    return null;
  }
  if (songs.length === 0 && !loading) {
    return <EmptySongs filtered={hasActiveFilter} />;
  }

  return (
    <>
      {videos.isError && (
        <p role="alert" className="px-4 text-sm text-destructive">
          {t('library.videoTagsFailed')}
        </p>
      )}
      <div
        ref={setScrollContainer}
        data-song-layout={view}
        className="themed-scrollbar song-table-shell min-h-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {view === 'table' ? (
          <SongTable
            songs={songs}
            videoHashes={videos.data ?? EMPTY_VIDEO_HASHES}
            sort={sort}
            sortingDisabled={sortingDisabled}
            onSort={onSort}
            getItemProps={getItemProps}
          />
        ) : (
          <SongGrid
            songs={songs}
            videoHashes={videos.data ?? EMPTY_VIDEO_HASHES}
            getItemProps={getItemProps}
          />
        )}
        <div ref={sentinelRef} className="h-1" aria-hidden="true" />
      </div>
    </>
  );
};
