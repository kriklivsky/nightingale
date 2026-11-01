import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useI18n } from '@/shared/i18n/use-i18n';

import { isSignedOut, loadState, type RemoteSong, type RemoteState } from './api';

const REMOTE_STATE = ['remote-state'];

export const useRemoteState = () =>
  useQuery({
    queryKey: REMOTE_STATE,
    queryFn: loadState,
    refetchInterval: (state, query) => {
      if (isSignedOut(query.state.error)) {
        return false;
      }
      return state?.tv?.screen === 'playback' ? 1000 : 3000;
    },
  });

export function useRemoteAction<T>(
  action: (input: T) => Promise<RemoteState>,
  successMessage?: (input: T) => string,
) {
  const queryClient = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: action,
    onSuccess: (state, input) => {
      queryClient.setQueryData(REMOTE_STATE, state);
      if (successMessage !== undefined) {
        toast.success(successMessage(input));
      }
    },
    onError: (error: Error) => toast.error(t('remote.actionFailed', { detail: error.message })),
  });
}

const MISSING_LYRICS_PREFIX = 'No matching synchronized lyrics';

const missingLyrics = (song: RemoteSong): boolean =>
  song.error?.startsWith(MISSING_LYRICS_PREFIX) === true;

/** The analyzer's reason for a failure that the status label does not explain. */
export const failureDetail = (song: RemoteSong): string | null =>
  song.status === 'failed' && !missingLyrics(song) ? song.error : null;

export function useSongStatusLabel() {
  const { t } = useI18n();

  return (song: RemoteSong): string | null => {
    switch (song.status) {
      case 'ready':
        return null;
      case 'queued':
        return t('status.queued');
      case 'analyzing':
        return t('status.analyzingProgress', { progress: song.progress ?? 0 });
      case 'failed':
        return missingLyrics(song) ? t('status.noTimedLyrics') : t('status.failed');
      case 'notAnalyzed':
        return t('status.notAnalyzed');
    }
    song.status satisfies never;
    throw new Error('Unknown song status');
  };
}
