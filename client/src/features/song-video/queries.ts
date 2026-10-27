import { useQuery } from '@tanstack/react-query';

import { getSongVideo, listSongVideoHashes } from '@/bridge/song-video';
import { useConfig } from '@/shared/config/use-config';
import { SONG_VIDEO_ATTACHMENTS, SONG_VIDEOS } from '@/shared/query-keys';

export const songVideoKey = (fileHash: string) => [...SONG_VIDEOS, fileHash];
const hashSet = (hashes: string[]) => new Set(hashes);

export function useSongVideoHashes(enabled: boolean) {
  const { data: config } = useConfig();
  return useQuery({
    queryKey: [...SONG_VIDEO_ATTACHMENTS, config?.data_path, config?.cache_paths],
    queryFn: listSongVideoHashes,
    select: hashSet,
    staleTime: 30_000,
    enabled,
  });
}

export function useSongVideo(fileHash: string) {
  return useQuery({
    queryKey: songVideoKey(fileHash),
    queryFn: () => getSongVideo(fileHash),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
