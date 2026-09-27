import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from 'react';

import type { Song } from '@/types/Song';

export type FocusPanel = 'songList' | 'sidebar' | 'songDetails';
export type FocusSource = 'mouse' | 'nav';

export type MenuFocus = {
  active: boolean;
  panel: FocusPanel;
  songIndex: number;
  songActionIndex: number | null;
  sidebarIndex: number;
  sidebarSubIndex: number;
  actionsFocused: boolean;
  actionsIndex: number;
  source: FocusSource;
};

export type MenuFocusActions = {
  onConfirmSong: ((index: number) => void) | null;
  onConfirmSongAction: ((songIndex: number, actionIndex: number) => void) | null;
  onConfirmSidebar: ((index: number) => void) | null;
  onConfirmActions: ((index: number) => boolean) | null;
  onSidebarBack: (() => boolean) | null;
  isSidebarBusy: (() => boolean) | null;
  hasSongDetails: boolean;
  songCount: number;
  sidebarCount: number;
  sidebarSubCountByIndex: Map<number, number>;
};

export type MenuFocusContextValue = {
  focus: MenuFocus;
  setFocus: (updater: (prev: MenuFocus) => MenuFocus) => void;
  activate: () => void;
  actionsRef: RefObject<MenuFocusActions>;
  scrollRef: RefObject<HTMLElement | null>;
  scrollTopRef: RefObject<number>;
  sidebarScrollRef: RefObject<HTMLElement | null>;
  sidebarScrollTopRef: RefObject<number>;
  selectedSong: Song | null;
  setSelectedSong: (song: Song | null) => void;
};

const MenuFocusContext = createContext<MenuFocusContextValue | null>(null);

const INITIAL_FOCUS: MenuFocus = {
  active: false,
  panel: 'songList',
  songIndex: 0,
  songActionIndex: null,
  sidebarIndex: 0,
  sidebarSubIndex: 0,
  actionsFocused: false,
  actionsIndex: 0,
  source: 'nav',
};

const INITIAL_ACTIONS: MenuFocusActions = {
  onConfirmSong: null,
  onConfirmSongAction: null,
  onConfirmSidebar: null,
  onConfirmActions: null,
  onSidebarBack: null,
  isSidebarBusy: null,
  hasSongDetails: false,
  songCount: 0,
  sidebarCount: 0,
  sidebarSubCountByIndex: new Map(),
};

export function MenuFocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocusState] = useState<MenuFocus>(INITIAL_FOCUS);
  const actionsRef = useRef<MenuFocusActions>({ ...INITIAL_ACTIONS });
  const scrollRef = useRef<HTMLElement | null>(null);
  const scrollTopRef = useRef<number>(0);
  const sidebarScrollRef = useRef<HTMLElement | null>(null);
  const sidebarScrollTopRef = useRef<number>(0);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);

  const setFocus = useCallback((updater: (prev: MenuFocus) => MenuFocus) => {
    setFocusState(updater);
  }, []);

  const activate = useCallback(() => {
    setFocusState((prev) => (prev.active ? prev : { ...prev, active: true }));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle(
      'remote-navigation',
      focus.active && focus.source === 'nav',
    );
    return () => document.documentElement.classList.remove('remote-navigation');
  }, [focus.active, focus.source]);

  const value = useMemo(
    () => ({
      focus,
      setFocus,
      activate,
      actionsRef,
      scrollRef,
      scrollTopRef,
      sidebarScrollRef,
      sidebarScrollTopRef,
      selectedSong,
      setSelectedSong,
    }),
    [focus, setFocus, activate, selectedSong],
  );

  return <MenuFocusContext.Provider value={value}>{children}</MenuFocusContext.Provider>;
}

export function useMenuFocus(): MenuFocusContextValue {
  const ctx = useContext(MenuFocusContext);
  if (!ctx) {
    throw new Error('useMenuFocus must be used within MenuFocusProvider');
  }
  return ctx;
}
