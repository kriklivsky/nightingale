import {
  StarIcon,
  ChevronDown,
  ChevronRight,
  Flame,
  FileQuestionMark,
  FolderIcon,
  ListMusicIcon,
  LoaderCircleIcon,
  UserIcon,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';

import { useFavoriteHashes } from '@/features/library/hooks/use-favorites';
import { ANALYSIS_STATUS_STYLES } from '@/features/library/lib/analysis-status-styles';
import { artistParents, visibleArtistAlbums } from '@/features/library/lib/artist-album-tree';
import { folderParents, visibleFolders } from '@/features/library/lib/folder-tree';
import {
  FAVORITES_LIBRARY_FILTER,
  libraryFiltersEqual,
  isLibraryMenuItemActive,
  libraryFilterFromMenuSelection,
  type LibraryMenuSection,
} from '@/features/library/lib/library-menu-filter';
import { useLibraryMenuItems } from '@/features/library/queries/use-library-menu-items';
import { useLibraryFilter } from '@/features/menu/hooks/use-library-filter';
import { useSidebarArtistsExpanded } from '@/features/menu/hooks/use-sidebar-artists-expanded';
import { useSidebarFoldersExpanded } from '@/features/menu/hooks/use-sidebar-folders-expanded';
import { useSidebarSectionsOpen } from '@/features/menu/hooks/use-sidebar-sections-open';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import {
  SidebarNavProvider,
  useSidebarRowFocus,
  type SidebarNavRow,
} from '@/features/menu/providers/sidebar-nav-context';
import { Badge } from '@/shared/components/ui/badge';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/shared/components/ui/collapsible';
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuSkeleton,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  useSidebar,
} from '@/shared/components/ui/sidebar';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { usePersistentScroll } from '@/shared/hooks/use-persistent-scroll';
import type { MessageKey, Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';
import type { LibraryMenuFilters } from '@/types/LibraryMenuFilters';
import type { LibraryMenuItem } from '@/types/LibraryMenuItem';

import { FolderActions } from './folder-actions';

type NavSectionConfig = {
  section: LibraryMenuSection;
  labelKey: MessageKey;
  icon: LucideIcon;
};

const NAV_SECTIONS: NavSectionConfig[] = [
  { section: 'hot', labelKey: 'menu.section.hot', icon: Flame },
  { section: 'artists', labelKey: 'menu.section.artists', icon: UserIcon },
  { section: 'playlists', labelKey: 'menu.section.playlists', icon: ListMusicIcon },
  { section: 'folders', labelKey: 'menu.section.folders', icon: FolderIcon },
  { section: 'no_metadata', labelKey: 'menu.section.noMetadata', icon: FileQuestionMark },
];

type MenuItemCountsProps = {
  item: LibraryMenuItem;
};

function MenuItemCounts({ item }: MenuItemCountsProps) {
  const { t } = useI18n();
  if (item.count === 0n) {
    return null;
  }
  const pending = item.queuedCount + item.analysingCount;

  return (
    <span
      className="flex shrink-0 items-center gap-1"
      title={t('menu.counts', {
        total: item.count,
        ready: item.analysedCount,
        pending,
      })}
    >
      {pending > 0n && (
        <Badge
          className={cn('h-5 gap-1 px-1.5 text-xs tabular-nums', ANALYSIS_STATUS_STYLES.analysing)}
        >
          <LoaderCircleIcon
            className="size-3 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
          {pending.toString()}
        </Badge>
      )}
      <Badge variant="secondary" className="h-5 px-1.5 text-xs tabular-nums">
        {item.count.toString()}
      </Badge>
    </span>
  );
}

type TreeNode = {
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
};

type ItemTree = {
  parents: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  onToggle: (value: string) => void;
};

/** Built-in menu entries carry fixed English labels from the backend; translate them by value. */
const BUILT_IN_ITEM_LABELS: ReadonlyMap<string, MessageKey> = new Map([
  ['hot:all', 'menu.hot.all'],
  ['hot:queued', 'menu.hot.queued'],
  ['hot:analysed', 'menu.hot.analysed'],
  ['hot:videos', 'menu.hot.videos'],
  ['hot:usdx', 'menu.hot.usdx'],
  ['no_metadata:unknown_artist', 'menu.noMetadata.unknownArtist'],
  ['no_metadata:unknown_album', 'menu.noMetadata.unknownAlbum'],
]);

function itemLabel(t: Translate, section: LibraryMenuSection, item: LibraryMenuItem): string {
  const key = BUILT_IN_ITEM_LABELS.get(`${section}:${item.value}`);
  return key === undefined ? item.label : t(key);
}

const itemSection = (section: LibraryMenuSection, item: LibraryMenuItem): LibraryMenuSection =>
  section === 'artists' && item.depth === 1 ? 'albums' : section;

type LibraryNavSubItemProps = {
  section: LibraryMenuSection;
  item: LibraryMenuItem;
  filter: LibraryMenuFilters;
  onSelectItem: (section: LibraryMenuSection, item: LibraryMenuItem) => void;
  treeNode?: TreeNode;
};

type TreeToggleProps = {
  node: TreeNode;
  label: string;
};

function TreeToggle({ node, label }: TreeToggleProps) {
  const { t } = useI18n();
  if (!node.expandable) {
    return <span aria-hidden className="size-5 shrink-0" />;
  }
  return (
    <button
      type="button"
      aria-label={node.expanded ? t('menu.collapse', { label }) : t('menu.expand', { label })}
      aria-expanded={node.expanded}
      onClick={node.onToggle}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-sidebar-foreground/70 hover:bg-sidebar-accent"
    >
      <ChevronRight
        className={cn(
          'size-3.5 transition-transform motion-reduce:transition-none',
          node.expanded && 'rotate-90',
        )}
      />
    </button>
  );
}

function LibraryNavSubItem({
  section,
  item,
  filter,
  onSelectItem,
  treeNode,
}: LibraryNavSubItemProps) {
  const { t } = useI18n();
  const { isSidebarActive, isItemFocused, itemIndex } = useSidebarRowFocus(section, item.value);
  const depth = item.depth ?? 0;
  return (
    <SidebarMenuSubItem
      className={cn(treeNode && 'flex items-center gap-0.5')}
      style={depth > 0 ? { paddingInlineStart: `${depth * 0.75}rem` } : undefined}
    >
      {treeNode && <TreeToggle node={treeNode} label={item.label} />}
      <SidebarMenuButton
        data-sidebar-nav-index={itemIndex}
        isActive={isLibraryMenuItemActive(section, item, filter)}
        className={cn(
          'flex h-fit items-center justify-between gap-2 px-2 py-1.5 hover:ring-primary',
          treeNode && 'min-w-0 flex-1',
          isSidebarActive && isItemFocused && 'ring-2 ring-primary bg-sidebar-accent',
        )}
        onClick={() => onSelectItem(section, item)}
      >
        {itemLabel(t, section, item)}
        <MenuItemCounts item={item} />
      </SidebarMenuButton>
    </SidebarMenuSubItem>
  );
}

type LibraryNavSectionProps = {
  items: LibraryMenuItem[];
  filter: LibraryMenuFilters;
  open: boolean;
  onToggleOpen: (open: boolean) => void;
  onSelectItem: (section: LibraryMenuSection, item: LibraryMenuItem) => void;
  itemTree?: ItemTree;
} & NavSectionConfig;

function LibraryNavSection({
  section,
  labelKey,
  icon: Icon,
  items,
  filter,
  open,
  onToggleOpen,
  onSelectItem,
  itemTree,
}: LibraryNavSectionProps) {
  const { t } = useI18n();
  const { isSidebarActive, isCollapseFocused, collapseIndex } = useSidebarRowFocus(section);

  return (
    <Collapsible open={open} onOpenChange={onToggleOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            data-sidebar-nav-index={collapseIndex}
            className={`flex w-full justify-between hover:ring-primary ${
              isSidebarActive && isCollapseFocused ? 'ring-2 ring-primary bg-sidebar-accent' : ''
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon className="size-4 shrink-0" />
              {t(labelKey)}
            </span>
            <ChevronDown className="transition-transform group-data-[state=open]/collapsible:rotate-180" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 pr-0">
            {items.map((item) => {
              const sectionForItem = itemSection(section, item);
              return (
                <LibraryNavSubItem
                  key={`${sectionForItem}:${item.value}`}
                  section={sectionForItem}
                  item={item}
                  filter={filter}
                  onSelectItem={onSelectItem}
                  treeNode={
                    itemTree && {
                      expandable: itemTree.parents.has(item.value),
                      expanded: itemTree.expanded.has(item.value),
                      onToggle: () => itemTree.onToggle(item.value),
                    }
                  }
                />
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

type MainNavigationProps = {
  baseIndex: number;
  registerCallbacks: (callbacks: (() => void)[], ready: boolean) => void;
  folderFocusedSidebarIndex: number;
  registerFolderCallback: (callback: ((subIndex: number) => void) | null) => void;
};

export const MainNavigation = ({
  baseIndex,
  registerCallbacks,
  folderFocusedSidebarIndex,
  registerFolderCallback,
}: MainNavigationProps) => {
  const { t } = useI18n();
  const { data: menu, isLoading: isLoadingMenu } = useLibraryMenuItems();
  const { data: favoriteHashes = [] } = useFavoriteHashes();
  const { setOpen } = useSidebar();
  const isMobile = useIsMobile();
  const { setLibraryFilter, ...filter } = useLibraryFilter();
  const { focus } = useMenuFocus();
  const navigate = useNavigate();
  const { setScrollContainer } = usePersistentScroll('sidebar');
  const [openBySection, setOpenBySection] = useSidebarSectionsOpen();
  const [expandedArtists, setExpandedArtists] = useSidebarArtistsExpanded();
  const [expandedFolders, setExpandedFolders] = useSidebarFoldersExpanded();
  const filterRef = useLatestRef(filter);

  const selectMenuItem = useCallback(
    (section: LibraryMenuSection, item: LibraryMenuItem) => {
      setLibraryFilter((current) => ({
        ...libraryFilterFromMenuSelection(section, item),
        status: current.status,
        transcript_source: current.transcript_source,
      }));
      if (isMobile) {
        setOpen(false);
      }
      void navigate('/');
    },
    [isMobile, navigate, setLibraryFilter, setOpen],
  );

  const selectFavorites = useCallback(() => {
    setLibraryFilter((current) => ({
      ...FAVORITES_LIBRARY_FILTER,
      status: current.status,
      transcript_source: current.transcript_source,
    }));
    if (isMobile) {
      setOpen(false);
    }
    void navigate('/');
  }, [isMobile, navigate, setLibraryFilter, setOpen]);

  const parentArtists = useMemo(() => artistParents(menu?.albums ?? []), [menu]);
  const parentFolders = useMemo(() => folderParents(menu?.folders ?? []), [menu]);

  const toggleArtist = useCallback(
    (value: string) => {
      setExpandedArtists((prev) => {
        const next = new Set(prev);
        if (!next.delete(value)) {
          next.add(value);
        }
        return next;
      });
    },
    [setExpandedArtists],
  );

  const toggleFolder = useCallback(
    (value: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (!next.delete(value)) {
          next.add(value);
        }
        return next;
      });
    },
    [setExpandedFolders],
  );

  // Activating a parent opens it; activating it again while selected closes it,
  // so keyboard and gamepad can fold either tree too.
  const activateMenuItem = useCallback(
    (section: LibraryMenuSection, item: LibraryMenuItem) => {
      const parents = section === 'artists' ? parentArtists : parentFolders;
      const setExpanded = section === 'artists' ? setExpandedArtists : setExpandedFolders;
      if ((section === 'artists' || section === 'folders') && parents.has(item.value)) {
        const reselected = isLibraryMenuItemActive(section, item, filterRef.current);
        setExpanded((prev) => {
          const next = new Set(prev);
          if (reselected && prev.has(item.value)) {
            next.delete(item.value);
          } else {
            next.add(item.value);
          }
          return next;
        });
      }
      selectMenuItem(section, item);
    },
    [
      filterRef,
      parentArtists,
      parentFolders,
      selectMenuItem,
      setExpandedArtists,
      setExpandedFolders,
    ],
  );

  const visibleSections = useMemo(() => {
    if (!menu) {
      return [];
    }

    return NAV_SECTIONS.map((config) => {
      const items = menu[config.section].filter(({ count }) => count > 0n);
      let visibleItems = items;
      if (config.section === 'artists') {
        visibleItems = visibleArtistAlbums(
          items,
          menu.albums.filter(({ count }) => count > 0n),
          expandedArtists,
        );
      } else if (config.section === 'folders') {
        visibleItems = visibleFolders(items, expandedFolders);
      }
      return Object.assign({}, config, { visibleItems });
    }).filter(({ visibleItems }) => visibleItems.length > 0);
  }, [menu, expandedArtists, expandedFolders]);

  const rows = useMemo<SidebarNavRow[]>(() => {
    return visibleSections.flatMap(({ section, visibleItems }) => {
      const sectionRows: SidebarNavRow[] = [{ kind: 'collapse', section }];
      if (openBySection[section]) {
        sectionRows.push(
          ...visibleItems.map((item) => ({
            kind: 'item' as const,
            section: itemSection(section, item),
            value: item.value,
          })),
        );
      }
      return sectionRows;
    });
  }, [visibleSections, openBySection]);

  useEffect(() => {
    const callbacks = rows.map((row) => {
      if (row.kind === 'collapse') {
        return () => {
          setOpenBySection((prev) => ({ ...prev, [row.section]: !prev[row.section] }));
        };
      }

      return () => {
        const item = menu?.[row.section].find((entry) => entry.value === row.value);
        if (!item) {
          return;
        }
        activateMenuItem(row.section, item);
      };
    });

    registerCallbacks([selectFavorites, ...callbacks], !isLoadingMenu);

    return () => {
      registerCallbacks([], false);
    };
  }, [
    rows,
    menu,
    activateMenuItem,
    registerCallbacks,
    setOpenBySection,
    selectFavorites,
    isLoadingMenu,
  ]);

  const isSidebarActive = focus.active && focus.panel === 'sidebar';

  useEffect(() => {
    if (!isSidebarActive || focus.source === 'mouse' || isLoadingMenu) {
      return undefined;
    }

    const rafId = requestAnimationFrame(() => {
      const focusedItem = document.querySelector<HTMLElement>(
        `[data-sidebar-nav-index="${focus.sidebarIndex}"]`,
      );
      focusedItem?.scrollIntoView({ block: 'nearest' });
    });

    return () => cancelAnimationFrame(rafId);
  }, [focus.sidebarIndex, focus.source, isSidebarActive, isLoadingMenu]);

  const showEmptyPlaceholder = isLoadingMenu;
  const itemTrees: Partial<Record<LibraryMenuSection, ItemTree>> = {
    artists: {
      parents: parentArtists,
      expanded: expandedArtists,
      onToggle: toggleArtist,
    },
    folders: {
      parents: parentFolders,
      expanded: expandedFolders,
      onToggle: toggleFolder,
    },
  };

  return (
    <SidebarContent className="overflow-hidden">
      <FolderActions
        focusedSidebarIndex={folderFocusedSidebarIndex}
        registerCallback={registerFolderCallback}
      />
      <div
        ref={setScrollContainer}
        className="no-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        <SidebarGroup>
          <SidebarMenu>
            {showEmptyPlaceholder ? (
              <SidebarMenuItem className="px-1 py-2">
                <div className="space-y-1">
                  <SidebarMenuSkeleton showIcon />
                  <SidebarMenuSkeleton showIcon />
                  <SidebarMenuSkeleton showIcon />
                </div>
              </SidebarMenuItem>
            ) : (
              <>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    data-sidebar-nav-index={baseIndex}
                    isActive={libraryFiltersEqual(filter, FAVORITES_LIBRARY_FILTER)}
                    className={`flex min-h-10 w-full justify-between text-sm hover:ring-primary ${
                      isSidebarActive && focus.sidebarIndex === baseIndex
                        ? 'ring-2 ring-primary bg-sidebar-accent'
                        : ''
                    }`}
                    onClick={selectFavorites}
                  >
                    <span className="flex items-center gap-2">
                      <StarIcon className="size-4 shrink-0" />
                      {t('menu.favorites')}
                    </span>
                    <Badge variant="secondary">{favoriteHashes.length}</Badge>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarNavProvider rows={rows} baseIndex={baseIndex + 1}>
                  {visibleSections.map((config) => (
                    <LibraryNavSection
                      key={config.section}
                      section={config.section}
                      labelKey={config.labelKey}
                      icon={config.icon}
                      items={config.visibleItems}
                      filter={filter}
                      open={openBySection[config.section]}
                      onToggleOpen={(open) => {
                        setOpenBySection((prev) => ({ ...prev, [config.section]: open }));
                      }}
                      onSelectItem={activateMenuItem}
                      itemTree={itemTrees[config.section]}
                    />
                  ))}
                </SidebarNavProvider>
              </>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </div>
    </SidebarContent>
  );
};
