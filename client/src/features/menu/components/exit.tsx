import { useCallback } from 'react';

import { exit } from '@/bridge/exit';
import { useDialog } from '@/features/menu/hooks/use-dialog';
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
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

export const ExitDialog = () => {
  const { t } = useI18n();
  const { close, mode } = useDialog();

  const open = mode === 'exit';

  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        close();
      } else {
        void exit();
      }
    },
    [close],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: close,
  });

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('menu.exit')}</AlertDialogTitle>
          <AlertDialogDescription>{t('exit.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={close}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 0 && RING)}
          >
            {t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void exit()}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 1 && RING)}
          >
            {t('menu.exit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
