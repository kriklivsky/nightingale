import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  downloadSongVideo,
  removeSongVideo,
  searchSongVideos,
  setSongVideoOffset,
  type SongVideo,
} from '@/bridge/song-video';
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import { SONG_VIDEO_ATTACHMENTS } from '@/shared/query-keys';

import { songVideoKey, useSongVideo } from './queries';

type Operation =
  | { action: 'download'; id: string }
  | { action: 'offset'; value: number }
  | { action: 'remove' };

function message(t: Translate, error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return error === null || error === undefined ? null : t('video.operationFailed');
}

async function perform(
  fileHash: string,
  token: string,
  action: Operation,
): Promise<SongVideo | null> {
  switch (action.action) {
    case 'download':
      return await downloadSongVideo(fileHash, action.id, token);
    case 'offset':
      return await setSongVideoOffset(fileHash, action.value, token);
    case 'remove':
      await removeSongVideo(fileHash, token);
      return null;
    default:
      throw new Error('Unknown video operation');
  }
}

export function useVideoWorkspace(fileHash: string) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [token, setToken] = useState('');
  const [search, setSearch] = useState<{ titleOnly: boolean; attempt: number } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const video = useSongVideo(fileHash);
  const candidates = useQuery({
    queryKey: ['song-video-search', fileHash, search?.titleOnly, search?.attempt],
    queryFn: () => searchSongVideos(fileHash, search?.titleOnly ?? false, token),
    enabled: search !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const operation = useMutation({
    mutationFn: (action: Operation) => perform(fileHash, token, action),
    onSuccess: (result) => {
      client.setQueryData(songVideoKey(fileHash), result);
      setDraft(null);
    },
    onSettled: (_result, _error, action) => {
      if (action.action !== 'offset') {
        void client.invalidateQueries({ queryKey: SONG_VIDEO_ATTACHMENTS });
      }
    },
  });
  const offset = draft ?? video.data?.offset_sec ?? 0;
  const runSearch = (titleOnly: boolean) =>
    setSearch((previous) => ({ titleOnly, attempt: (previous?.attempt ?? 0) + 1 }));
  const adjust = (delta: number) =>
    setDraft(Math.min(600, Math.max(-600, Math.round((offset + delta) * 1000) / 1000)));
  return {
    token,
    setToken,
    video,
    candidates,
    operation,
    offset,
    runSearch,
    adjust,
    searched: search !== null,
    error: message(t, operation.error) ?? message(t, candidates.error) ?? message(t, video.error),
  };
}
