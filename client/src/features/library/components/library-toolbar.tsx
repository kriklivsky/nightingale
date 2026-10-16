import { Grid2X2Icon, ListIcon, ListMusicIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { useSearch } from '@/features/menu/hooks/use-search';
import { useMenuFocus, type MenuFocus } from '@/features/menu/providers/menu-focus-context';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { SidebarTrigger } from '@/shared/components/ui/sidebar';
import { cn } from '@/shared/utils/cn';
import type { SongSort } from '@/types/SongSort';

import { BulkActionsMenu } from './bulk-actions-menu';

const DEBOUNCE_MS = 500;
const SORT_OPTIONS: readonly { value: string; label: string; sort: SongSort }[] = [
  {
    value: 'title:ascending',
    label: 'Title A–Z',
    sort: { column: 'title', direction: 'ascending' },
  },
  {
    value: 'title:descending',
    label: 'Title Z–A',
    sort: { column: 'title', direction: 'descending' },
  },
  {
    value: 'artist:ascending',
    label: 'Artist A–Z',
    sort: { column: 'artist', direction: 'ascending' },
  },
  {
    value: 'artist:descending',
    label: 'Artist Z–A',
    sort: { column: 'artist', direction: 'descending' },
  },
  {
    value: 'album:ascending',
    label: 'Album A–Z',
    sort: { column: 'album', direction: 'ascending' },
  },
  {
    value: 'album:descending',
    label: 'Album Z–A',
    sort: { column: 'album', direction: 'descending' },
  },
  {
    value: 'duration:ascending',
    label: 'Shortest first',
    sort: { column: 'duration', direction: 'ascending' },
  },
  {
    value: 'duration:descending',
    label: 'Longest first',
    sort: { column: 'duration', direction: 'descending' },
  },
  {
    value: 'status:ascending',
    label: 'Status A–Z',
    sort: { column: 'status', direction: 'ascending' },
  },
  {
    value: 'status:descending',
    label: 'Status Z–A',
    sort: { column: 'status', direction: 'descending' },
  },
];
export type SongListView = 'table' | 'grid';

function isToolbarActionFocused(focus: MenuFocus, index: number): boolean {
  return (
    focus.active &&
    focus.panel === 'songList' &&
    focus.actionsFocused &&
    focus.actionsIndex === index
  );
}

const actionRing = (focus: MenuFocus, index: number): string | undefined =>
  isToolbarActionFocused(focus, index) ? 'ring-2 ring-primary' : undefined;

function selectedSortValue(sort: readonly SongSort[]): string {
  if (sort.length === 0) {
    return 'default';
  }
  if (sort.length > 1) {
    return 'custom';
  }
  return `${sort[0].column}:${sort[0].direction}`;
}

function changeSort(value: string, onSortChange: (sort: SongSort[] | null) => void): void {
  if (value === 'default') {
    onSortChange(null);
    return;
  }
  const selected = SORT_OPTIONS.find((option) => option.value === value);
  if (selected) {
    onSortChange([selected.sort]);
  }
}

const viewVariant = (view: SongListView, buttonView: SongListView) =>
  view === buttonView ? 'secondary' : 'ghost';

const optionalFilter = (value: string): string | null => (value === 'all' ? null : value);

const queueLabel = (count: number): string =>
  `Open playback queue, ${count} ${count === 1 ? 'song' : 'songs'}`;

function finishSearch(
  event: KeyboardEvent<HTMLInputElement>,
  timerRef: RefObject<ReturnType<typeof setTimeout> | undefined>,
  setSearch: (value: string) => void,
): void {
  if (event.key !== 'Escape' && event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  clearTimeout(timerRef.current);
  setSearch(event.currentTarget.value);
  event.currentTarget.blur();
}

type LibraryToolbarProps = {
  view: SongListView;
  sort: readonly SongSort[];
  queueCount: number;
  onOpenQueue: () => void;
  onViewChange: (view: SongListView) => void;
  onSortChange: (sort: SongSort[] | null) => void;
  isSavingView?: boolean;
};

export const LibraryToolbar = ({
  view,
  sort,
  queueCount,
  onOpenQueue,
  onViewChange,
  onSortChange,
  isSavingView,
}: LibraryToolbarProps) => {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { search, setSearch } = useSearch();
  const { setMode } = useDialog();
  const [pending, setPending] = useState<{ base: string; value: string } | null>(null);
  const { status, transcript_source, setLibraryFilter } = useLibraryFilter();
  const { focus } = useMenuFocus();

  const handleChange = (value: string) => {
    setPending({ base: search, value });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSearch(value), DEBOUNCE_MS);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const displayedSearch = pending?.base === search ? pending.value : search;
  const currentSort = selectedSortValue(sort);

  return (
    <div className="grid w-full grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(12rem,1fr)_auto_auto_auto_auto]">
      <div className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-3 2xl:col-span-1">
        <SidebarTrigger variant="outline" size="icon" className="shrink-0 md:hidden" />
        <Input
          data-actions-index="0"
          value={displayedSearch}
          onChange={({ target: { value } }) => handleChange(value)}
          onKeyDown={(event) => finishSearch(event, timerRef, setSearch)}
          onClick={() => {
            if (document.documentElement.classList.contains('tvbox-session')) {
              clearTimeout(timerRef.current);
              setPending(null);
              setMode('song-search');
            }
          }}
          className={cn('min-w-0 flex-1', actionRing(focus, 0))}
          placeholder="Search songs"
          aria-label="Search songs"
        />
      </div>
      <Select
        value={status ?? 'all'}
        onValueChange={(value) =>
          setLibraryFilter((current) => ({
            ...current,
            status: optionalFilter(value),
          }))
        }
      >
        <SelectTrigger
          data-actions-index="1"
          aria-label="Filter by analysis status"
          className={cn('w-full min-w-0 2xl:w-32', actionRing(focus, 1))}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Status</SelectLabel>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="not_analyzed">Not analyzed</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="analyzing">Analyzing</SelectItem>
            <SelectItem value="analyzed">Analyzed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={transcript_source ?? 'all'}
        onValueChange={(value) =>
          setLibraryFilter((current) => ({
            ...current,
            transcript_source: optionalFilter(value),
          }))
        }
      >
        <SelectTrigger
          data-actions-index="2"
          aria-label="Filter by transcript type"
          className={cn('w-full min-w-0 2xl:w-32', actionRing(focus, 2))}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Type</SelectLabel>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="generated">Generated</SelectItem>
            <SelectItem value="lyrics">AI Aligned</SelectItem>
            <SelectItem value="lrc">LRC</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={currentSort}
        onValueChange={(value) => changeSort(value, onSortChange)}
        disabled={isSavingView}
      >
        <SelectTrigger
          data-actions-index="3"
          aria-label="Sort songs"
          className={cn('w-full min-w-0 2xl:w-36', actionRing(focus, 3))}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Sort songs</SelectLabel>
            <SelectItem value="default">Default order</SelectItem>
            {currentSort === 'custom' && (
              <SelectItem value="custom" disabled>
                Custom sort
              </SelectItem>
            )}
            {SORT_OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
        <Button
          variant="outline"
          size="icon"
          className={cn('relative', actionRing(focus, 4))}
          data-actions-index="4"
          onClick={onOpenQueue}
          aria-label={queueLabel(queueCount)}
          title="Playback queue"
        >
          <ListMusicIcon />
          {queueCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {queueCount}
            </span>
          ) : null}
        </Button>
        <BulkActionsMenu actionIndex={5} />
        <fieldset
          className="flex shrink-0 rounded-md border bg-input/20 p-0.5"
          aria-label="Song list view"
        >
          <Button
            variant={viewVariant(view, 'table')}
            size="icon-sm"
            className={actionRing(focus, 6)}
            data-actions-index="6"
            disabled={isSavingView}
            onClick={() => onViewChange('table')}
            aria-label="Table view"
            aria-pressed={view === 'table'}
            title="Table view"
          >
            <ListIcon />
          </Button>
          <Button
            variant={viewVariant(view, 'grid')}
            size="icon-sm"
            className={actionRing(focus, 7)}
            data-actions-index="7"
            disabled={isSavingView}
            onClick={() => onViewChange('grid')}
            aria-label="Card grid view"
            aria-pressed={view === 'grid'}
            title="Card grid view"
          >
            <Grid2X2Icon />
          </Button>
        </fieldset>
      </div>
    </div>
  );
};
