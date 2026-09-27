import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { deleteLocalSong } from '@/bridge/songs';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';
import { ANALYSIS_QUEUE, FAVORITES, MENU, SONGS, SONGS_META } from '@/shared/query-keys';
import { cn } from '@/shared/utils/cn';

const focusClass = (open: boolean, focusedIndex: number, index: number): string =>
  cn(
    'focus-visible:ring-0 focus-visible:border-transparent',
    open && focusedIndex === index && 'ring-2 ring-primary',
  );

export function DeleteSongDialog() {
  const { mode, close } = useDialog();
  const { selectedSong, setSelectedSong } = useMenuFocus();
  const queryClient = useQueryClient();
  const deletingRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const song = typeof mode === 'object' && mode?.mode === 'delete-song' ? mode.song : null;
  const open = song !== null;

  const cancel = useCallback(() => {
    if (!deletingRef.current) {
      close();
    }
  }, [close]);

  const runDelete = useCallback(async () => {
    if (!song || deletingRef.current) {
      return;
    }
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteLocalSong(song);
      if (selectedSong?.path === song.path) {
        setSelectedSong(null);
      }
      close();
      toast.success(`Deleted ${song.title} from disk`);
      void Promise.all(
        [SONGS, SONGS_META, FAVORITES, ANALYSIS_QUEUE, MENU].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ).catch((error: unknown) => {
        toast.error(
          `Files were deleted, but the library could not refresh: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    } catch (error) {
      toast.error(
        `Could not delete song: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }, [close, queryClient, selectedSong, setSelectedSong, song]);

  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        cancel();
      } else {
        void runDelete();
      }
    },
    [cancel, runDelete],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: cancel,
  });

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && cancel()}>
      <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {song?.title ?? 'song'}?</AlertDialogTitle>
          <AlertDialogDescription>
            {song?.usdx
              ? 'Permanently delete this UltraStar song file and its referenced audio, video, vocals, and cover files from disk? This cannot be undone.'
              : 'Permanently delete this song file from disk? This cannot be undone.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={deleting}
            onClick={cancel}
            className={focusClass(open, focusedIndex, 0)}
          >
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={deleting}
            onClick={() => void runDelete()}
            className={focusClass(open, focusedIndex, 1)}
          >
            {deleting ? 'Deleting…' : 'Delete files'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
