import { z } from 'zod';

import { invoke, invokeAuthenticated, isTauri } from './runtime';

const songVideoSchema = z.object({
  video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().max(1200),
  offset_sec: z.number().finite().min(-600).max(600),
  audio_matched: z.boolean(),
  path: z.string().min(1),
});

const candidateSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().max(1200),
  channel: z.string().max(1200),
  duration_sec: z.number().finite().positive().max(1200).nullable(),
});

export type SongVideo = z.infer<typeof songVideoSchema>;
export type VideoCandidate = z.infer<typeof candidateSchema>;
export const videoTokenRequired = !isTauri;

export async function listSongVideoHashes(): Promise<string[]> {
  return z
    .array(z.string().regex(/^[A-Fa-f0-9]{32}$/))
    .parse(await invoke('list_song_video_hashes'));
}

export async function getSongVideo(fileHash: string): Promise<SongVideo | null> {
  return songVideoSchema.nullable().parse(await invoke('get_song_video', { fileHash }));
}

export async function searchSongVideos(
  fileHash: string,
  titleOnly: boolean,
  token: string,
): Promise<VideoCandidate[]> {
  return z
    .array(candidateSchema)
    .max(8)
    .parse(await invokeAuthenticated('search_song_videos', { fileHash, titleOnly }, token));
}

export async function downloadSongVideo(
  fileHash: string,
  videoId: string,
  token: string,
): Promise<SongVideo> {
  return songVideoSchema.parse(
    await invokeAuthenticated('download_song_video', { fileHash, videoId }, token),
  );
}

export async function setSongVideoOffset(
  fileHash: string,
  offsetSec: number,
  token: string,
): Promise<SongVideo> {
  return songVideoSchema.parse(
    await invokeAuthenticated('set_song_video_offset', { fileHash, offsetSec }, token),
  );
}

export async function removeSongVideo(fileHash: string, token: string): Promise<void> {
  await invokeAuthenticated('remove_song_video', { fileHash }, token);
}
