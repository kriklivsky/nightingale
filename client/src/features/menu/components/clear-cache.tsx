import { useCallback } from 'react';

import { useClearCache } from '@/features/library/hooks/use-clear-cache';
import {
  useDialog,
  type ClearCacheTarget,
  type DialogMode,
} from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import type { MessageKey } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

const clearCacheTarget = (mode: DialogMode): ClearCacheTarget | null => {
  if (typeof mode !== 'object' || mode === null || mode.mode !== 'clear-cache') {
    return null;
  }

  return mode.target;
};

const focusClass = (open: boolean, focusedIndex: number, index: number): string =>
  cn(NO_FOCUS_RING, open && focusedIndex === index && RING);

const COPY: Record<ClearCacheTarget, { title: MessageKey; description: MessageKey }> = {
  all: { title: 'cache.allTitle', description: 'cache.allDescription' },
  videos: { title: 'cache.videosTitle', description: 'cache.videosDescription' },
  models: { title: 'cache.modelsTitle', description: 'cache.modelsDescription' },
};

export const ClearCacheDialog = () => {
  const { t } = useI18n();
  const { close, mode } = useDialog();
  const clearCache = useClearCache();

  const target = clearCacheTarget(mode);
  const open = target !== null;

  const runClear = useCallback(() => {
    if (!target) {
      return;
    }
    void clearCache[target]();
    close();
  }, [target, clearCache, close]);

  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        close();
      } else {
        runClear();
      }
    },
    [close, runClear],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: close,
  });

  const copy = target ? COPY[target] : null;

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(copy?.title ?? 'cache.title')}</AlertDialogTitle>
          <AlertDialogDescription>{copy ? t(copy.description) : ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close} className={focusClass(open, focusedIndex, 0)}>
            {t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={runClear}
            className={focusClass(open, focusedIndex, 1)}
          >
            {t('cache.clear')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
