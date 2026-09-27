import { memo } from 'react';

import { Stars } from '@/shared/components/shared/stars';
import { cn } from '@/shared/utils/cn';
import { formatSeconds } from '@/shared/utils/format-duration';

import { AlbumArt } from '../shared/album-art';
import { LanguageBadge } from '../shared/language-badge';
import { StatusBadge } from '../shared/status-badge';
import type { SongItemProps } from '../types';
import { SongRowActions } from './song-row-actions';

type SongGridCardProps = {
  bestScore?: number;
} & SongItemProps;

export const SongGridCard = memo(
  ({
    song,
    queueStatus,
    index,
    isFocused,
    isSelected,
    isFavorite,
    focusedAction,
    canPlay,
    canDelete,
    onSelect,
    onToggleFavorite,
    onPlay,
    onDelete,
    bestScore,
  }: SongGridCardProps) => (
    <div
      data-song-index={index}
      data-nav-focused={isFocused}
      className={cn(
        'group h-full min-h-32 min-w-0 rounded-lg border bg-card p-3 transition-colors hover:border-ring hover:bg-muted/40',
        (isFocused || isSelected) && 'border-ring bg-muted ring-2 ring-ring/30',
      )}
    >
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={onSelect}
        className="flex w-full min-w-0 cursor-pointer items-start gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <AlbumArt
          song={song}
          className="size-24 rounded-md"
          fallbackIconClassName="size-5"
          showVideoBadge
        />
        <div className="flex min-w-0 flex-1 self-stretch flex-col py-0.5">
          <div className="line-clamp-2 text-sm leading-snug font-semibold">{song.title}</div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{song.artist || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{song.album || '—'}</p>
          {bestScore === undefined ? null : <Stars score={bestScore} size="sm" className="mt-1" />}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatSeconds(song.duration_secs)}
            </span>
            <div className="flex items-center gap-1">
              <LanguageBadge language={song.language} />
              <StatusBadge song={song} queueStatus={queueStatus} />
            </div>
          </div>
        </div>
      </button>
      <div className="mt-2 border-t border-border/70 pt-2">
        <SongRowActions
          song={song}
          isFavorite={isFavorite}
          focusedAction={focusedAction}
          canPlay={canPlay}
          canDelete={canDelete}
          onToggleFavorite={onToggleFavorite}
          onPlay={onPlay}
          onDelete={onDelete}
        />
      </div>
    </div>
  ),
);
