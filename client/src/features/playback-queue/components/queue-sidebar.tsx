import { ListMusicIcon, PlayIcon, Trash2Icon, UsersIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

import type { PlaybackQueueEntry } from '@/bridge/playback-queue';
import type { PlaybackPlayer } from '@/bridge/playback-session';
import { useSongDetailsNav } from '@/features/library/components/song-details/use-song-details-nav';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { QueueList } from '@/features/playback-queue/components/queue-list';
import {
  useClearPlaybackQueue,
  useMovePlaybackQueueEntry,
  useRemovePlaybackQueueEntry,
  useStartNextPlaybackQueueSong,
} from '@/features/playback-queue/use-playback-queue';
import { MultiplayerSetupDialog } from '@/features/playback/components/dialogs/multiplayer-setup';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/components/ui/alert-dialog';
import { Button } from '@/shared/components/ui/button';
import { Spinner } from '@/shared/components/ui/spinner';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

type QueueSidebarProps = {
  entries: PlaybackQueueEntry[];
  onClose: () => void;
};

const queuePlaybackDisabled = (
  entryCount: number,
  preparing: boolean,
  clearing: boolean,
): boolean => entryCount === 0 || preparing || clearing;

const dialogFocusClass = (open: boolean, focusedIndex: number, index: number): string =>
  cn(
    'focus-visible:border-transparent focus-visible:ring-0',
    open && focusedIndex === index && 'ring-2 ring-primary',
  );

export function QueueSidebar({ entries, onClose }: QueueSidebarProps) {
  const { t } = useI18n();
  const [multiplayerOpen, setMultiplayerOpen] = useState(false);
  const { isPreparing, playNext } = useStartNextPlaybackQueueSong(entries);
  const { mutate: move, isLoading: reordering } = useMovePlaybackQueueEntry();
  const { mutate: remove, isLoading: removing } = useRemovePlaybackQueueEntry();
  const { mutate: clear, isLoading: clearing } = useClearPlaybackQueue();
  const { mode, setMode, close: closeDialog } = useDialog();
  const { detailsRef, closeDetails } = useSongDetailsNav(onClose, multiplayerOpen);
  const confirmOpen = mode === 'clear-playback-queue';
  const confirmClear = () => {
    clear();
    closeDialog();
  };
  const playbackDisabled =
    queuePlaybackDisabled(entries.length, isPreparing, clearing) || reordering;
  const { focusedIndex } = useDialogNav({
    open: confirmOpen,
    itemCount: 2,
    onConfirm: (index) => (index === 0 ? closeDialog() : confirmClear()),
    onBack: closeDialog,
  });

  return (
    <aside
      ref={detailsRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l bg-background [&_[data-song-details-focused=true]]:z-10 [&_[data-song-details-focused=true]]:ring-2 [&_[data-song-details-focused=true]]:ring-primary xl:w-[28rem] xl:flex-none"
      aria-label={t('library.queue')}
    >
      <header className="flex items-center gap-3 border-b p-3">
        <ListMusicIcon className="size-5" />
        <h2 className="min-w-0 flex-1 text-sm font-semibold">{t('library.queue')}</h2>
        <Button variant="ghost" size="icon-sm" onClick={closeDetails} aria-label={t('queue.close')}>
          <XIcon />
        </Button>
      </header>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        <QueueList
          entries={entries}
          disabled={reordering || removing || clearing}
          onMove={move}
          onRemove={remove}
        />
      </div>

      <footer className="flex flex-col gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          size="lg"
          data-song-details-primary
          className="h-12 w-full text-base"
          disabled={playbackDisabled}
          aria-busy={isPreparing}
          onClick={() => playNext()}
        >
          {isPreparing ? (
            <>
              <Spinner className="size-4" /> {t('songDetails.preparing')}
            </>
          ) : (
            <>
              <PlayIcon /> {t('queue.play')}
            </>
          )}
        </Button>
        <div className="grid grid-cols-2 gap-2" data-song-details-nav-group>
          <Button
            variant="outline"
            size="lg"
            className="h-11"
            disabled={playbackDisabled}
            onClick={() => setMultiplayerOpen(true)}
            aria-label={t('queue.playMultiplayer')}
          >
            <UsersIcon />
            {t('songDetails.multiplayer')}
          </Button>
          <AlertDialog
            open={confirmOpen}
            onOpenChange={(open) => setMode(open ? 'clear-playback-queue' : null)}
          >
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="lg"
                className="h-11"
                disabled={playbackDisabled || removing}
              >
                <Trash2Icon />
                {t('queue.clear')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('queue.clearTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('queue.clearDescription', { count: entries.length })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  className={dialogFocusClass(confirmOpen, focusedIndex, 0)}
                  onClick={closeDialog}
                >
                  {t('common.cancel')}
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  className={dialogFocusClass(confirmOpen, focusedIndex, 1)}
                  onClick={confirmClear}
                >
                  {t('queue.clear')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </footer>

      <MultiplayerSetupDialog
        open={multiplayerOpen}
        onOpenChange={setMultiplayerOpen}
        onStart={(players: PlaybackPlayer[]) => playNext(players)}
        queuePlayback
      />
    </aside>
  );
}
