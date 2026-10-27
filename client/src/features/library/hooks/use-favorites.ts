import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { loadFavoriteHashes, setSongFavorite } from '@/bridge/songs';
import { useI18n } from '@/shared/i18n/use-i18n';
import { FAVORITES, SONGS } from '@/shared/query-keys';

export const useFavoriteHashes = () =>
  useQuery({
    queryKey: FAVORITES,
    queryFn: loadFavoriteHashes,
  });

export const useSetSongFavorite = () => {
  const queryClient = useQueryClient();
  const { t } = useI18n();

  return useMutation({
    mutationFn: ({ fileHash, favorite }: { fileHash: string; favorite: boolean }) =>
      setSongFavorite(fileHash, favorite),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: FAVORITES }),
        queryClient.invalidateQueries({ queryKey: SONGS }),
      ]);
    },
    onError: (error: unknown) => {
      toast.error(
        t('favorites.updateFailed', {
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
    },
  });
};
