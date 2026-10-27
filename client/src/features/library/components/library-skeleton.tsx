import { Skeleton } from '@/shared/components/ui/skeleton';
import { useI18n } from '@/shared/i18n/use-i18n';

const ROWS = 8;

/** Placeholder shown while the library metadata loads, so the screen is never blank. */
export function LibrarySkeleton() {
  const { t } = useI18n();

  return (
    <div
      className="flex min-h-0 w-full flex-1 flex-col gap-3 p-3 sm:p-4"
      aria-busy="true"
      aria-label={t('library.loading')}
    >
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-36" />
      </div>
      <Skeleton className="h-px w-full" />
      {Array.from({ length: ROWS }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
