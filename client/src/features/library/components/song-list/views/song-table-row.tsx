import { memo, type KeyboardEvent } from 'react';

import { cn } from '@/shared/utils/cn';

import { SONG_COLUMNS } from '../song-columns';
import type { SongItemProps } from '../types';
import { SongRowActions } from './song-row-actions';

type SongTableRowProps = {
  bestScore?: number;
} & SongItemProps;

export const SongTableRow = memo(
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
  }: SongTableRowProps) => {
    const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
        return;
      }
      event.preventDefault();
      onSelect();
    };

    return (
      <tr
        tabIndex={0}
        data-song-index={index}
        data-nav-focused={isFocused}
        aria-selected={isSelected}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={cn(
          'cursor-pointer border-b border-border/70 outline-none [&>td]:bg-background [&>td]:transition-colors hover:[&>td]:bg-accent focus-visible:[&>td]:bg-primary/15',
          (isFocused || isSelected) && '[&>td]:bg-primary/15 hover:[&>td]:bg-primary/20',
        )}
      >
        {SONG_COLUMNS.map((column) => (
          <td key={column.id} className={column.tdClassName}>
            {column.cell(song, queueStatus, bestScore)}
          </td>
        ))}
        <td className="song-table-actions px-2 py-1">
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
        </td>
      </tr>
    );
  },
);
