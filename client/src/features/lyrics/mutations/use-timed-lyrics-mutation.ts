import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { alignLrcLyrics, applyTimedLyrics, provideLrc } from '@/bridge/lyrics';
import { useI18n } from '@/shared/i18n/use-i18n';
import { ANALYSIS_QUEUE, LYRICS, MENU, SONGS, SONGS_META } from '@/shared/query-keys';

const LYRICS_QUERY_KEYS = [LYRICS, MENU, SONGS, SONGS_META, ANALYSIS_QUEUE];

const invalidateLyricsQueries = (queryClient: ReturnType<typeof useQueryClient>) => {
  for (const key of LYRICS_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
};

export type ProvideLrcInput = {
  hash: string;
  lrcText: string;
  separateStems: boolean;
  title: string;
};

export const useProvideLrcMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: async ({ hash, lrcText, separateStems, title }: ProvideLrcInput) => {
      await provideLrc(hash, lrcText, separateStems);
      toast.info(
        separateStems ? t('lyrics.separatingStems', { title }) : t('lyrics.savedTimed', { title }),
      );
    },
    onSuccess: () => invalidateLyricsQueries(queryClient),
    onError: (error: Error) => {
      toast.error(t('lyrics.provideFailed', { detail: error.message }));
    },
  });
};

export type ApplyTimedLyricsInput = {
  hash: string;
  lrcText: string;
  title: string;
};

export const useApplyTimedLyricsMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: async ({ hash, lrcText, title }: ApplyTimedLyricsInput) => {
      await applyTimedLyrics(hash, lrcText);
      toast.info(t('lyrics.appliedTimed', { title }));
    },
    onSuccess: () => invalidateLyricsQueries(queryClient),
    onError: (error: Error) => {
      toast.error(t('lyrics.applyFailed', { detail: error.message }));
    },
  });
};

export const useAlignLrcMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: async ({ hash, lrcText, title }: ApplyTimedLyricsInput) => {
      await alignLrcLyrics(hash, lrcText);
      toast.info(t('lyrics.aligningWords', { title }));
    },
    onSuccess: () => invalidateLyricsQueries(queryClient),
    onError: (error: Error) => {
      toast.error(t('lyrics.alignFailed', { detail: error.message }));
    },
  });
};
