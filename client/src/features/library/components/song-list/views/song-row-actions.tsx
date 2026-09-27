import { PlayIcon, StarIcon, Trash2Icon } from 'lucide-react';

import { cn } from '@/shared/utils/cn';

import type { SongItemProps } from '../types';

type SongRowActionsProps = Pick<
  SongItemProps,
  | 'song'
  | 'isFavorite'
  | 'focusedAction'
  | 'canPlay'
  | 'canDelete'
  | 'onToggleFavorite'
  | 'onPlay'
  | 'onDelete'
>;

const deleteTitle = (canDelete: boolean): string =>
  canDelete ? 'Delete files from disk' : 'Only idle local songs can be deleted in the desktop app';

export function SongRowActions({
  song,
  isFavorite,
  focusedAction,
  canPlay,
  canDelete,
  onToggleFavorite,
  onPlay,
  onDelete,
}: SongRowActionsProps) {
  const actionClass =
    'inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/75 text-muted-foreground outline-none hover:border-primary hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        aria-label={`${isFavorite ? 'Remove' : 'Add'} ${song.title} ${isFavorite ? 'from' : 'to'} favorites`}
        aria-pressed={isFavorite}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          actionClass,
          isFavorite && 'text-amber-400',
          focusedAction === 0 && 'border-primary ring-2 ring-primary text-foreground',
        )}
      >
        <StarIcon className={cn('size-4', isFavorite && 'fill-current')} />
      </button>
      <button
        type="button"
        aria-label={`Play ${song.title}`}
        title={canPlay ? 'Play' : 'Analyze this song before playing'}
        disabled={!canPlay}
        onClick={(event) => {
          event.stopPropagation();
          onPlay();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          actionClass,
          'text-primary disabled:cursor-not-allowed disabled:opacity-40',
          focusedAction === 1 && 'border-primary ring-2 ring-primary',
        )}
      >
        <PlayIcon className="size-4 fill-current" />
      </button>
      <button
        type="button"
        aria-label={`Delete ${song.title} from disk`}
        title={deleteTitle(canDelete)}
        disabled={!canDelete}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          actionClass,
          'text-destructive disabled:cursor-not-allowed disabled:opacity-40',
          focusedAction === 2 && 'border-primary ring-2 ring-primary',
        )}
      >
        <Trash2Icon className="size-4" />
      </button>
    </div>
  );
}
