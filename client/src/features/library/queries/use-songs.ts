import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { getPreloadedSongsMeta, loadAnalysisQueue, loadSongs, loadSongsMeta } from '@/bridge/songs';
import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { useSearch } from '@/features/menu/hooks/use-search';
import { useConfig } from '@/shared/config/use-config';
import { ANALYSIS_QUEUE, SONGS, SONGS_META, MENU } from '@/shared/query-keys';
import type { AnalysisQueue } from '@/types/AnalysisQueue';
import type { LoadSongsParams } from '@/types/LoadSongsParams';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { SongsMeta } from '@/types/SongsMeta';

const PAGE_SIZE = 25;
const DEFAULT_REFETCH_INTERVAL = 2500;

function queueStatusKind(status: QueuedStatus): string {
  if (typeof status === 'string') {
    return status;
  }
  return 'Analyzing' in status ? 'Analyzing' : 'Failed';
}

export const useSongsMeta = () => {
  const queryClient = useQueryClient();
  const preloaded = getPreloadedSongsMeta();
  const previousMetaRef = useRef<SongsMeta | undefined>(preloaded);

  return useQuery({
    queryKey: SONGS_META,
    queryFn: loadSongsMeta,
    refetchInterval: DEFAULT_REFETCH_INTERVAL,
    ...(preloaded !== undefined ? { initialData: preloaded } : {}),
    onSuccess: (meta: SongsMeta) => {
      const previous = previousMetaRef.current;
      previousMetaRef.current = meta;
      if (
        previous !== undefined &&
        (previous.count !== meta.count ||
          previous.processed_count !== meta.processed_count ||
          previous.analyzed_count !== meta.analyzed_count ||
          previous.folder !== meta.folder)
      ) {
        void queryClient.invalidateQueries({ queryKey: SONGS });
        void queryClient.invalidateQueries({ queryKey: MENU });
      }
    },
  });
};

export const useSongs = () => {
  const { data: config } = useConfig();
  const { search } = useSearch();
  const { artist, album, playlist, folder, query, status, transcript_source } = useLibraryFilter();
  const sort = config?.song_list_sort ?? [];

  return useInfiniteQuery({
    queryKey: [
      ...SONGS,
      search,
      artist,
      album,
      playlist,
      folder,
      query,
      status,
      transcript_source,
      sort,
    ],
    queryFn: ({ pageParam = 0 }: { pageParam?: number }) => {
      const params: LoadSongsParams = {
        search: search || null,
        filters: {
          artist: artist ?? null,
          album: album ?? null,
          playlist: playlist ?? null,
          folder,
          query: query ?? null,
          status: status ?? null,
          transcript_source: transcript_source ?? null,
          search: null,
        },
        sort: sort.length === 0 ? null : sort,
        skip: pageParam,
        take: PAGE_SIZE,
      };
      return loadSongs(params);
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.processed.length, 0);
      return loaded < lastPage.processed_count ? loaded : undefined;
    },
  });
};

export const useAnalysisQueue = () => {
  const queryClient = useQueryClient();
  const prevEntriesRef = useRef<string | null>(null);

  return useQuery({
    queryKey: ANALYSIS_QUEUE,
    queryFn: loadAnalysisQueue,
    refetchInterval: 2500,
    onSuccess: (data: AnalysisQueue) => {
      const entries = Object.entries(data.entries)
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([hash, status]) => JSON.stringify([hash, queueStatusKind(status)]))
        .join('|');
      const previous = prevEntriesRef.current;

      if (previous !== null && previous !== entries) {
        void queryClient.invalidateQueries({ queryKey: SONGS });
        void queryClient.invalidateQueries({ queryKey: MENU });
        void queryClient.invalidateQueries({ queryKey: SONGS_META });
      }

      prevEntriesRef.current = entries;
    },
  });
};
