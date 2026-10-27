import type { MenuFocus } from '@/features/menu/providers/menu-focus-context';

/** `data-actions-index` of each library toolbar control, in remote/gamepad order. */
export const TOOLBAR_ACTION = {
  search: 0,
  ready: 1,
  filters: 2,
  sort: 3,
  queue: 4,
  bulk: 5,
  view: 6,
  retry: 7,
} as const;

/** Analysis status filter value meaning "ready to sing". */
export const READY_STATUS = 'analyzed';

export const actionRing = (focus: MenuFocus, index: number): string | undefined =>
  focus.active && focus.panel === 'songList' && focus.actionsFocused && focus.actionsIndex === index
    ? 'ring-2 ring-primary'
    : undefined;
