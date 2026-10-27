import { TriangleAlertIcon } from 'lucide-react';
import { useRef } from 'react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useSelectFolderSource } from '@/features/sources/mutations/use-source-mutations';
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
import { useConfig } from '@/shared/config/use-config';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

export const SourceChangeWarning = () => {
  const { t } = useI18n();
  const { data: config } = useConfig();

  if (!config?.library_source) {
    return null;
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2 border-y py-2 text-left text-xs/relaxed">
      <TriangleAlertIcon className="mt-0.5 size-3.5 text-destructive" />
      <div>
        <p className="font-bold">{t('source.clearWarningTitle')}</p>
        <p className="text-muted-foreground">{t('source.clearWarning')}</p>
      </div>
    </div>
  );
};

export const FolderSourceConfirmDialog = () => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const { mode, close } = useDialog();
  const selectFolder = useSelectFolderSource();
  const open = mode === 'folder-source-confirm';
  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onBack: close,
    containerRef,
  });
  const focusClass = (index: number) =>
    cn(
      'focus-visible:ring-0 focus-visible:border-transparent',
      focusedIndex === index && 'ring-2 ring-primary',
    );

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('source.changeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('source.clearWarning')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter ref={containerRef}>
          <AlertDialogCancel onClick={close} className={focusClass(0)}>
            {t('common.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              close();
              selectFolder.mutate();
            }}
            className={focusClass(1)}
          >
            {t('source.chooseFolder')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
