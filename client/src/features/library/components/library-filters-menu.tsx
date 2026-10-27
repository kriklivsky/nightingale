import { FilterIcon, XIcon } from 'lucide-react';

import { useToolbarMenu } from '@/features/library/hooks/use-toolbar-menu';
import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import type { MessageKey } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

const ALL = 'all';

const STATUS_OPTIONS: readonly { value: string; labelKey: MessageKey }[] = [
  { value: ALL, labelKey: 'library.filter.allStatuses' },
  { value: 'analyzed', labelKey: 'status.ready' },
  { value: 'not_analyzed', labelKey: 'status.notAnalyzed' },
  { value: 'queued', labelKey: 'status.queued' },
  { value: 'analyzing', labelKey: 'status.analyzing' },
  { value: 'failed', labelKey: 'status.failed' },
];

const TRANSCRIPT_OPTIONS: readonly { value: string; labelKey: MessageKey }[] = [
  { value: ALL, labelKey: 'library.filter.allTypes' },
  { value: 'lrc', labelKey: 'transcript.lrc' },
  { value: 'usdx', labelKey: 'transcript.usdx' },
  { value: 'lyrics', labelKey: 'transcript.aligned' },
  { value: 'generated', labelKey: 'transcript.generated' },
];

const optionalFilter = (value: string): string | null => (value === ALL ? null : value);

/** Analysis status and transcript type filters, grouped behind one toolbar stop. */
export function LibraryFiltersMenu({ actionIndex }: { actionIndex: number }) {
  const { t } = useI18n();
  const { status, transcript_source, setLibraryFilter } = useLibraryFilter();
  const { open, setOpen, focused } = useToolbarMenu(actionIndex);
  const activeCount = Number(status !== null) + Number(transcript_source !== null);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          data-actions-index={actionIndex}
          aria-label={t('library.filter.label', { count: activeCount })}
          className={cn(
            'min-w-0 border-input bg-input/20 focus-visible:border-transparent focus-visible:ring-0 dark:bg-input/30',
            focused && 'ring-2 ring-primary',
          )}
        >
          <FilterIcon />
          <span className="truncate">{t('library.filter.title')}</span>
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>{t('library.filter.status')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={status ?? ALL}
          onValueChange={(value) =>
            setLibraryFilter((current) => ({ ...current, status: optionalFilter(value) }))
          }
        >
          {STATUS_OPTIONS.map(({ value, labelKey }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {t(labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('library.filter.type')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={transcript_source ?? ALL}
          onValueChange={(value) =>
            setLibraryFilter((current) => ({
              ...current,
              transcript_source: optionalFilter(value),
            }))
          }
        >
          {TRANSCRIPT_OPTIONS.map(({ value, labelKey }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {t(labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {activeCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                setLibraryFilter((current) => ({
                  ...current,
                  status: null,
                  transcript_source: null,
                }))
              }
            >
              <XIcon />
              {t('library.filter.reset')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
