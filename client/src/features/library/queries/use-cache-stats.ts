import { useQuery } from '@tanstack/react-query';

import { calculateCacheStats } from '@/bridge/cache';
import { useConfig } from '@/shared/config/use-config';
import { CACHE_STATS } from '@/shared/query-keys';

export const useCacheStats = () => {
  const { data: config } = useConfig();
  return useQuery({
    queryKey: [...CACHE_STATS, config?.data_path, config?.cache_paths],
    queryFn: calculateCacheStats,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
};
