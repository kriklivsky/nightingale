import { useCallback } from 'react';

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
import { cn } from '@/shared/utils/cn';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

type PauseOverlayProps = {
  open: boolean;
  exitLabel: string;
  onExit: () => void;
  onContinue: () => void;
};

export const PauseOverlay = ({ open, exitLabel, onExit, onContinue }: PauseOverlayProps) => {
  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        onContinue();
      } else {
        onExit();
      }
    },
    [onContinue, onExit],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: onContinue,
  });

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="sm:max-w-xl" onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-2xl">Paused</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            Exiting now won&apos;t save your progress
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onContinue}
            className={cn('min-h-12 text-base', NO_FOCUS_RING, open && focusedIndex === 0 && RING)}
          >
            Continue
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={onExit}
            className={cn('min-h-12 text-base', NO_FOCUS_RING, open && focusedIndex === 1 && RING)}
          >
            {exitLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
