import { ArrowDownIcon, ArrowUpIcon, PlayIcon, Trash2Icon } from 'lucide-react';

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
import { useI18n } from '@/shared/i18n/use-i18n';

import { clearQueue, moveInQueue, removeFromQueue, type RemoteState } from './api';
import { failureDetail, useRemoteAction, useSongStatusLabel } from './use-remote';

type QueuePanelProps = {
  queue: RemoteState['queue'];
  canStart: boolean;
  onStart: () => void;
};

export function QueuePanel({ queue, canStart, onStart }: QueuePanelProps) {
  const { t } = useI18n();
  const statusLabel = useSongStatusLabel();
  const move = useRemoteAction(({ id, index }: { id: string; index: number }) =>
    moveInQueue(id, index),
  );
  const remove = useRemoteAction(removeFromQueue);
  const clear = useRemoteAction(clearQueue);
  const busy = move.isLoading || remove.isLoading || clear.isLoading;
  const nextId = queue.find((entry) => entry.song.status === 'ready')?.id;

  if (queue.length === 0) {
    return <p className="py-10 text-center text-muted-foreground">{t('queue.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {canStart ? (
        <Button
          size="lg"
          className="h-12 text-base"
          disabled={nextId === undefined}
          onClick={onStart}
        >
          <PlayIcon /> {t('remote.startQueue')}
        </Button>
      ) : null}
      <ol className="divide-y">
        {queue.map((entry, index) => {
          const title = entry.song.title;
          const status = entry.id === nextId ? t('queue.nextUp') : statusLabel(entry.song);
          return (
            <li key={entry.id} className="flex items-center gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{title}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {entry.song.artist || '—'}
                  {status === null ? null : <span className="text-primary">{` · ${status}`}</span>}
                </p>
                {failureDetail(entry.song) === null ? null : (
                  <p className="line-clamp-2 text-xs text-destructive">
                    {failureDetail(entry.song)}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11"
                disabled={busy || index === 0}
                onClick={() => move.mutate({ id: entry.id, index: index - 1 })}
                aria-label={t('queue.moveUp', { title })}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11"
                disabled={busy || index + 1 === queue.length}
                onClick={() => move.mutate({ id: entry.id, index: index + 1 })}
                aria-label={t('queue.moveDown', { title })}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-lg"
                className="size-11"
                disabled={busy}
                onClick={() => remove.mutate(entry.id)}
                aria-label={t('queue.remove', { title })}
              >
                <Trash2Icon />
              </Button>
            </li>
          );
        })}
      </ol>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="lg" className="h-11 self-end text-sm" disabled={busy}>
            <Trash2Icon /> {t('queue.clear')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('queue.clearTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('queue.clearDescription', { count: queue.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('remote.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => clear.mutate(undefined)}>
              {t('queue.clear')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
