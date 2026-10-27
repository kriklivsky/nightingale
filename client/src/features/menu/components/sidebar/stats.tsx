import { useCacheStats } from '@/features/library/queries/use-cache-stats';
import { formatBytes, segmentPercent, totalUsedBytes } from '@/features/library/utils/stats';
import { SegmentedProgress } from '@/shared/components/ui/segmented-progress';
import type { MessageKey } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';

import { CacheActions } from './cache-actions';

const rows = [
  { labelKey: 'cache.songs', color: 'bg-blue-500', key: 'songs_bytes' },
  { labelKey: 'cache.videos', color: 'bg-green-500', key: 'videos_bytes' },
  { labelKey: 'cache.models', color: 'bg-yellow-500', key: 'models_bytes' },
  { labelKey: 'cache.other', color: 'bg-gray-500', key: 'other_bytes' },
] as const satisfies readonly { labelKey: MessageKey; color: string; key: string }[];

type StatsProps = {
  cacheFocusedSidebarIndex: number;
  registerCacheCallback: (callback: ((subIndex: number) => void) | null) => void;
};

export const Stats = ({ cacheFocusedSidebarIndex, registerCacheCallback }: StatsProps) => {
  const { t } = useI18n();
  const { data: stats, isLoading, isError } = useCacheStats();

  const total = stats ? totalUsedBytes(stats) : 0n;

  const noStatsLabel = isError ? t('cache.statsUnavailable') : '…';

  const label = !stats ? noStatsLabel : t('cache.used', { size: formatBytes(total) });

  const renderHeader = () => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <CacheActions
        focusedSidebarIndex={cacheFocusedSidebarIndex}
        registerCallback={registerCacheCallback}
      />
    </div>
  );

  if (isLoading || !stats) {
    return (
      <div className="flex flex-col gap-2 px-2">
        {renderHeader()}
        {!isError && <div className="h-2 w-full rounded-full bg-muted" />}
      </div>
    );
  }

  const segments = rows.map((row) => ({
    value: segmentPercent(stats[row.key], total),
    color: row.color,
  }));

  return (
    <div className="flex flex-col gap-2 px-2">
      {renderHeader()}
      <SegmentedProgress segments={segments} />
      <div className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-0 py-0.5 text-xs">
            <div className="flex items-center gap-2">
              <div className={`size-2 shrink-0 rounded-full ${row.color}`} />
              <span className="flex-1">{t(row.labelKey)}</span>
              <span className="text-muted-foreground">{formatBytes(stats[row.key])}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
