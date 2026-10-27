import { PlayIcon, StarIcon, Trash2Icon } from 'lucide-react';

import { useI18n } from '@/shared/i18n/use-i18n';
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
  const { t } = useI18n();
  const actionClass =
    'inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/75 text-muted-foreground outline-none hover:border-primary hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        aria-label={t('songRow.favoriteLabel', { title: song.title })}
        aria-pressed={isFavorite}
        title={isFavorite ? t('songRow.removeFavorite') : t('songRow.addFavorite')}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite(song);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          actionClass,
          isFavorite && 'text-amber-400',
          focusedAction === 0 && 'border-primary ring-2 ring-primary text-foreground',
        )}
      >
        <StarIcon className={cn('size-5', isFavorite && 'fill-current')} />
      </button>
      <button
        type="button"
        aria-label={t('songRow.playLabel', { title: song.title })}
        title={canPlay ? t('songDetails.play') : t('songRow.analyzeFirst')}
        disabled={!canPlay}
        onClick={(event) => {
          event.stopPropagation();
          onPlay(song);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          actionClass,
          'text-primary disabled:cursor-not-allowed disabled:opacity-40',
          focusedAction === 1 && 'border-primary ring-2 ring-primary',
        )}
      >
        <PlayIcon className="size-5 fill-current" />
      </button>
      <button
        type="button"
        aria-label={t('songRow.deleteLabel', { title: song.title })}
        title={canDelete ? t('songRow.delete') : t('songRow.deleteUnavailable')}
        disabled={!canDelete}
        onClick={(event) => {
          event.stopPropagation();
          onDelete(song);
        }}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn(
          actionClass,
          'text-destructive disabled:cursor-not-allowed disabled:opacity-40',
          focusedAction === 2 && 'border-primary ring-2 ring-primary',
        )}
      >
        <Trash2Icon className="size-5" />
      </button>
    </div>
  );
}
