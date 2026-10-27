import {
  AlignLeftIcon,
  AudioLinesIcon,
  ImageIcon,
  RefreshCwIcon,
  Trash2Icon,
  XCircleIcon,
  EllipsisIcon,
} from 'lucide-react';

import { useAnalysis } from '@/features/library/hooks/use-analysis';
import { useToolbarMenu } from '@/features/library/hooks/use-toolbar-menu';
import { useSongs } from '@/features/library/queries/use-songs';
import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

type CancelAnalysisItemProps = {
  count: number;
  onClick: () => void;
};

const CancelAnalysisItem = ({ count, onClick }: CancelAnalysisItemProps) => {
  const { t } = useI18n();
  if (count === 0) {
    return null;
  }

  return (
    <DropdownMenuItem variant="destructive" onClick={onClick}>
      <XCircleIcon />
      {t('bulk.cancelAnalysis', { count })}
    </DropdownMenuItem>
  );
};

export const BulkActionsMenu = ({ actionIndex }: { actionIndex: number }) => {
  const {
    enqueueAll,
    cancelAnalysisAll,
    realignAll,
    reanalyzeAllFull,
    reanalyzeAllTranscript,
    refreshMetadataAll,
    deleteSongCacheAll,
  } = useAnalysis();
  const { t } = useI18n();
  const { data } = useSongs();
  const { analyzed_count: analyzedCount = 0, analysis_busy_count: analysisBusyCount = 0 } =
    data?.pages[0] ?? {};
  const { open, setOpen, focused } = useToolbarMenu(actionIndex);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          data-actions-index={actionIndex}
          aria-label={t('bulk.label')}
          title={t('bulk.title')}
          className={cn(
            'border-input bg-input/20 focus-visible:border-transparent focus-visible:ring-0 dark:bg-input/30',
            focused && 'ring-2 ring-primary',
          )}
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{t('bulk.allSongs')}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => void enqueueAll()}>
          <AudioLinesIcon />
          {t('bulk.analyzeAll')}
        </DropdownMenuItem>
        <CancelAnalysisItem count={analysisBusyCount} onClick={() => void cancelAnalysisAll()} />
        <DropdownMenuItem onClick={() => void refreshMetadataAll()}>
          <ImageIcon />
          {t('bulk.refreshMetadata')}
        </DropdownMenuItem>
        {analyzedCount > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {t('bulk.analyzedSongs', { count: analyzedCount })}
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void realignAll()}>
              <AlignLeftIcon />
              {t('bulk.realign')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reanalyzeAllTranscript()}>
              <RefreshCwIcon />
              {t('bulk.refetchLyrics')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void reanalyzeAllFull()}>
              <AudioLinesIcon />
              {t('bulk.fullReanalysis')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => void deleteSongCacheAll()}>
              <Trash2Icon />
              {t('bulk.deleteCache')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
