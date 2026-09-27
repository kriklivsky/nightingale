import type { AnalysisQueue } from '@/types/AnalysisQueue';
import type { LoadSongsParams } from '@/types/LoadSongsParams';
import type { Song } from '@/types/Song';
import type { SongsMeta } from '@/types/SongsMeta';
import type { SongsStore } from '@/types/SongsStore';

import { invoke, isTauri } from './runtime';

export const canDeleteLocalFiles = isTauri;

export function getPreloadedSongsMeta(): SongsMeta | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.__NIGHTINGALE_SONGS_META__;
}

export const loadSongs = async (params: LoadSongsParams): Promise<SongsStore> => {
  return await invoke<SongsStore>('load_songs', { params });
};

export const loadSongsByHashes = async (fileHashes: string[]): Promise<Song[]> => {
  return await invoke<Song[]>('load_songs_by_hashes', { fileHashes });
};

export const loadSongsMeta = async (): Promise<SongsMeta> => {
  return await invoke<SongsMeta>('load_songs_meta');
};

export const loadFavoriteHashes = async (): Promise<string[]> => {
  return await invoke<string[]>('load_favorite_hashes');
};

export const setSongFavorite = async (fileHash: string, favorite: boolean): Promise<void> => {
  await invoke('set_song_favorite', { fileHash, favorite });
};

export const deleteLocalSong = async (song: Song): Promise<void> => {
  await invoke('delete_local_song', { fileHash: song.file_hash, path: song.path });
};

export const loadAnalysisQueue = async (): Promise<AnalysisQueue> => {
  return await invoke<AnalysisQueue>('load_analysis_queue');
};
