import { useEffect, useState } from 'react';

import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';

/**
 * Open state for a library toolbar dropdown that remote/gamepad confirm opens
 * directly (Radix menus ignore synthetic clicks on their trigger).
 */
export function useToolbarMenu(actionIndex: number) {
  const [open, setOpen] = useState(false);
  const { focus, actionsRef } = useMenuFocus();

  useEffect(() => {
    const handlers = actionsRef.current.actionConfirmHandlers;
    handlers.set(actionIndex, () => setOpen(true));
    return () => {
      handlers.delete(actionIndex);
    };
  }, [actionIndex, actionsRef]);

  const focused =
    focus.active &&
    focus.panel === 'songList' &&
    focus.actionsFocused &&
    focus.actionsIndex === actionIndex;

  return { open, setOpen, focused };
}
