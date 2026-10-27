import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';

import { useSongWindow } from '@/features/library/hooks/use-song-window';
import { useBestScoresBySongForActiveProfile } from '@/features/profiles/hooks/use-best-scores-by-song';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';
import type { Song } from '@/types/Song';
import type { SongSort } from '@/types/SongSort';
import type { SongSortColumn } from '@/types/SongSortColumn';
import type { SortDirection } from '@/types/SortDirection';

import { SONG_COLUMNS, type SongColumn } from '../song-columns';
import type { SongItemProps } from '../types';
import { SongTableRow } from './song-table-row';

type SongTableProps = {
  songs: Song[];
  videoHashes: ReadonlySet<string>;
  sort: readonly SongSort[];
  sortingDisabled: boolean;
  onSort: (column: SongSortColumn) => void;
  getItemProps: (song: Song, index: number) => SongItemProps;
};

type SongTableHeaderProps = {
  column: SongColumn;
  sort: readonly SongSort[];
  sortingDisabled: boolean;
  onSort: (column: SongSortColumn) => void;
};

function sortIcon(direction: SortDirection | undefined) {
  if (direction === 'ascending') {
    return <ArrowUpIcon className="size-3 shrink-0 translate-y-px" aria-hidden="true" />;
  }
  if (direction === 'descending') {
    return <ArrowDownIcon className="size-3 shrink-0 translate-y-px" aria-hidden="true" />;
  }
  return (
    <ArrowUpDownIcon className="size-3 shrink-0 translate-y-px opacity-40" aria-hidden="true" />
  );
}

const SongTableHeader = ({ column, sort, sortingDisabled, onSort }: SongTableHeaderProps) => {
  const { t } = useI18n();
  const sortColumn = column.sortColumn;
  const header = t(column.headerKey);
  if (sortColumn === undefined) {
    return (
      <th className={column.thClassName}>
        <span className={cn(column.headerHidden === true && 'sr-only')}>{header}</span>
      </th>
    );
  }

  const sortIndex = sort.findIndex(({ column: sortedColumn }) => sortedColumn === sortColumn);
  const activeDirection = sortIndex === -1 ? undefined : sort[sortIndex].direction;
  const priority = sortIndex + 1;
  const icon = sortIcon(activeDirection);

  return (
    <th className={column.thClassName} aria-sort={sortIndex === 0 ? activeDirection : undefined}>
      <button
        type="button"
        disabled={sortingDisabled}
        className={cn(
          'flex w-full items-center gap-0.5 text-left outline-none hover:text-foreground focus-visible:text-foreground disabled:cursor-wait',
          column.id === 'status' && 'justify-end',
        )}
        onClick={() => onSort(sortColumn)}
      >
        {header}
        <span className="inline-flex items-start" aria-hidden="true">
          {icon}
          {activeDirection && (
            <sup className="-ml-0.5 text-[0.45rem] leading-none tabular-nums">{priority}</sup>
          )}
        </span>
        {activeDirection && (
          <span className="sr-only">
            {t(
              activeDirection === 'ascending'
                ? 'library.sortedAscending'
                : 'library.sortedDescending',
              {
                priority,
              },
            )}
          </span>
        )}
      </button>
    </th>
  );
};

export const SongTable = ({
  songs,
  videoHashes,
  sort,
  sortingDisabled,
  onSort,
  getItemProps,
}: SongTableProps) => {
  const { t } = useI18n();
  const bestScores = useBestScoresBySongForActiveProfile();
  const window = useSongWindow(songs, 'table');

  return (
    <table
      aria-rowcount={songs.length + 1}
      className="w-full table-fixed border-separate border-spacing-0 text-sm"
    >
      <thead className="song-table-header" data-song-window-header>
        <tr className="text-left text-muted-foreground">
          {SONG_COLUMNS.map((column) => (
            <SongTableHeader
              key={column.id}
              column={column}
              sort={sort}
              sortingDisabled={sortingDisabled}
              onSort={onSort}
            />
          ))}
          <th className="song-table-actions px-2 py-2 text-right font-medium">
            {t('songAction.heading')}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr aria-hidden="true" style={{ height: window.before }} />
        {window.rows.map((row) => (
          <SongTableRow
            key={row.key}
            {...getItemProps(songs[row.index], row.index)}
            bestScore={bestScores.get(songs[row.index].file_hash)}
            hasYoutubeVideo={videoHashes.has(songs[row.index].file_hash)}
            measure={window.measure}
          />
        ))}
        <tr aria-hidden="true" style={{ height: window.after }} />
      </tbody>
    </table>
  );
};
