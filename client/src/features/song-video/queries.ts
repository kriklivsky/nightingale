import { useQuery } from '@tanstack/react-query';

import { getSongVideo } from '@/bridge/song-video';

export const songVideoKey = (fileHash: string) => ['song-video', fileHash];

export function useSongVideo(fileHash: string) {
  return useQuery({
    queryKey: songVideoKey(fileHash),
    queryFn: () => getSongVideo(fileHash),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
