import { CheckCircle2Icon, Grid2X2Icon, ListIcon, ListMusicIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { actionRing, READY_STATUS, TOOLBAR_ACTION } from '@/features/library/lib/toolbar-actions';
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
import type { MessageKey } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';
import type { SongSort } from '@/types/SongSort';

import { BulkActionsMenu } from './bulk-actions-menu';
import { LibraryFiltersMenu } from './library-filters-menu';

const DEBOUNCE_MS = 500;
const SORT_OPTIONS: readonly { value: string; labelKey: MessageKey; sort: SongSort }[] = [
  {
    value: 'title:ascending',
    labelKey: 'library.sort.titleAsc',
    sort: { column: 'title', direction: 'ascending' },
  },
  {
    value: 'title:descending',
    labelKey: 'library.sort.titleDesc',
    sort: { column: 'title', direction: 'descending' },
  },
  {
    value: 'artist:ascending',
    labelKey: 'library.sort.artistAsc',
    sort: { column: 'artist', direction: 'ascending' },
  },
  {
    value: 'artist:descending',
    labelKey: 'library.sort.artistDesc',
    sort: { column: 'artist', direction: 'descending' },
  },
  {
    value: 'album:ascending',
    labelKey: 'library.sort.albumAsc',
    sort: { column: 'album', direction: 'ascending' },
  },
  {
    value: 'album:descending',
    labelKey: 'library.sort.albumDesc',
    sort: { column: 'album', direction: 'descending' },
  },
  {
    value: 'duration:ascending',
    labelKey: 'library.sort.shortest',
    sort: { column: 'duration', direction: 'ascending' },
  },
  {
    value: 'duration:descending',
    labelKey: 'library.sort.longest',
    sort: { column: 'duration', direction: 'descending' },
  },
  {
    value: 'status:ascending',
    labelKey: 'library.sort.statusAsc',
    sort: { column: 'status', direction: 'ascending' },
  },
  {
    value: 'status:descending',
    labelKey: 'library.sort.statusDesc',
    sort: { column: 'status', direction: 'descending' },
  },
];

export type SongListView = 'table' | 'grid';

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

function SearchField({ focus }: { focus: MenuFocus }) {
  const { t } = useI18n();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { search, setSearch } = useSearch();
  const { setMode } = useDialog();
  const [pending, setPending] = useState<{ base: string; value: string } | null>(null);

  const handleChange = (value: string) => {
    setPending({ base: search, value });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSearch(value), DEBOUNCE_MS);
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const displayedSearch = pending?.base === search ? pending.value : search;

  return (
    <Input
      data-actions-index={TOOLBAR_ACTION.search}
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
      className={cn('min-w-0 flex-1', actionRing(focus, TOOLBAR_ACTION.search))}
      placeholder={t('library.searchPlaceholder')}
      aria-label={t('library.searchPlaceholder')}
    />
  );
}

function ReadyToggle({ focus }: { focus: MenuFocus }) {
  const { t } = useI18n();
  const { status, setLibraryFilter } = useLibraryFilter();
  const active = status === READY_STATUS;

  return (
    <Button
      variant={active ? 'secondary' : 'outline'}
      data-actions-index={TOOLBAR_ACTION.ready}
      aria-pressed={active}
      className={cn('min-w-0', actionRing(focus, TOOLBAR_ACTION.ready))}
      onClick={() =>
        setLibraryFilter((current) => ({ ...current, status: active ? null : READY_STATUS }))
      }
    >
      <CheckCircle2Icon className={cn(active && 'text-primary')} />
      <span className="truncate">{t('library.readyOnly')}</span>
    </Button>
  );
}

type SortSelectProps = {
  focus: MenuFocus;
  sort: readonly SongSort[];
  disabled?: boolean;
  onSortChange: (sort: SongSort[] | null) => void;
};

function SortSelect({ focus, sort, disabled, onSortChange }: SortSelectProps) {
  const { t } = useI18n();
  const currentSort = selectedSortValue(sort);

  return (
    <Select
      value={currentSort}
      onValueChange={(value) => changeSort(value, onSortChange)}
      disabled={disabled}
    >
      <SelectTrigger
        data-actions-index={TOOLBAR_ACTION.sort}
        aria-label={t('library.sort.label')}
        className={cn('w-full min-w-0 2xl:w-40', actionRing(focus, TOOLBAR_ACTION.sort))}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t('library.sort.label')}</SelectLabel>
          <SelectItem value="default">{t('library.sort.default')}</SelectItem>
          {currentSort === 'custom' && (
            <SelectItem value="custom" disabled>
              {t('library.sort.custom')}
            </SelectItem>
          )}
          {SORT_OPTIONS.map(({ value, labelKey }) => (
            <SelectItem key={value} value={value}>
              {t(labelKey)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
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
  const { t } = useI18n();
  const { focus } = useMenuFocus();
  const nextView: SongListView = view === 'table' ? 'grid' : 'table';

  return (
    <div className="grid w-full grid-cols-2 items-center gap-2 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(12rem,1fr)_auto_auto_auto_auto]">
      <div className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-4 2xl:col-span-1">
        <SidebarTrigger variant="outline" size="icon" className="shrink-0 md:hidden" />
        <SearchField focus={focus} />
      </div>
      <ReadyToggle focus={focus} />
      <LibraryFiltersMenu actionIndex={TOOLBAR_ACTION.filters} />
      <SortSelect focus={focus} sort={sort} disabled={isSavingView} onSortChange={onSortChange} />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          className={cn('relative', actionRing(focus, TOOLBAR_ACTION.queue))}
          data-actions-index={TOOLBAR_ACTION.queue}
          onClick={onOpenQueue}
          aria-label={t('library.queueLabel', { count: queueCount })}
        >
          <ListMusicIcon />
          <span className="hidden lg:inline">{t('library.queue')}</span>
          {queueCount > 0 ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">
              {queueCount}
            </span>
          ) : null}
        </Button>
        <BulkActionsMenu actionIndex={TOOLBAR_ACTION.bulk} />
        <Button
          variant="outline"
          size="icon"
          className={actionRing(focus, TOOLBAR_ACTION.view)}
          data-actions-index={TOOLBAR_ACTION.view}
          disabled={isSavingView}
          onClick={() => onViewChange(nextView)}
          aria-label={nextView === 'grid' ? t('library.showGrid') : t('library.showTable')}
          title={nextView === 'grid' ? t('library.showGrid') : t('library.showTable')}
        >
          {nextView === 'grid' ? <Grid2X2Icon /> : <ListIcon />}
        </Button>
      </div>
    </div>
  );
};
