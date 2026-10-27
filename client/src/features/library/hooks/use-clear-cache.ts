import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { clearAll, clearModels, clearVideos } from '@/bridge/cache';
import { useI18n } from '@/shared/i18n/use-i18n';
import { CACHE_STATS, SONG_VIDEOS } from '@/shared/query-keys';

export const useClearCache = () => {
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const clearCacheFactory = (handler: () => Promise<void>) => {
    return async () => {
      try {
        await handler();

        void queryClient.invalidateQueries({ queryKey: CACHE_STATS });
        void queryClient.invalidateQueries({ queryKey: SONG_VIDEOS });

        toast.info(t('cache.cleared'));
      } catch (error: unknown) {
        toast.error(
          t('cache.clearFailed', {
            detail: error instanceof Error ? error.message : t('common.unknownError'),
          }),
        );
      }
    };
  };

  return {
    videos: clearCacheFactory(clearVideos),
    models: clearCacheFactory(clearModels),
    all: clearCacheFactory(clearAll),
  };
};
