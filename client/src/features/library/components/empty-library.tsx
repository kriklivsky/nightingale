import { Disc3Icon, FolderIcon, MusicIcon, RefreshCwIcon } from 'lucide-react';
import { useEffect } from 'react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useMenuFocus } from '@/features/menu/providers/menu-focus-context';
import { useLibrarySourceActions } from '@/features/sources/hooks/use-library-source-actions';
import { JellyfinIcon } from '@/shared/components/icons/jellyfin';
import { PlexIcon } from '@/shared/components/icons/plex';
import { Button } from '@/shared/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/shared/components/ui/empty';
import { cn } from '@/shared/utils/cn';

export const EmptyLibrary = () => {
  const { selectFolder, rescan, rescanDisabled, isPending, hasSource } = useLibrarySourceActions();
  const { setMode } = useDialog();
  const { focus, setFocus, actionsRef } = useMenuFocus();
  const actionClass = (index: number) =>
    cn(
      focus.active &&
        focus.panel === 'songList' &&
        focus.actionsFocused &&
        focus.actionsIndex === index &&
        'ring-2 ring-primary',
    );

  useEffect(() => {
    actionsRef.current.songCount = 0;
    setFocus((previous) =>
      previous.panel === 'songList' && previous.source === 'nav'
        ? {
            ...previous,
            actionsFocused: true,
            actionsIndex: 0,
            songActionIndex: null,
            source: 'nav',
          }
        : previous,
    );
  }, [actionsRef, setFocus]);

  // Once any source is configured, an empty list means that source is still
  // scanning or contains no supported files. This applies to the desktop app
  // as well as deployments that pin a folder through an environment variable.
  if (hasSource) {
    return (
      <Empty className="px-4 pt-16 md:pt-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MusicIcon />
          </EmptyMedia>
          <EmptyTitle>No songs found</EmptyTitle>
          <EmptyDescription>
            The configured music folder is empty or still being scanned. Add supported files to it,
            then rescan the library.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            data-actions-index="0"
            className={actionClass(0)}
            onClick={rescan}
            disabled={rescanDisabled}
          >
            <RefreshCwIcon /> Rescan library
          </Button>
        </EmptyContent>
        {focus.active && focus.source === 'nav' && (
          <p className="text-xs text-muted-foreground">OK Rescan · ← Library controls</p>
        )}
      </Empty>
    );
  }

  return (
    <Empty className="px-4 pt-16 md:pt-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MusicIcon />
        </EmptyMedia>
        <EmptyTitle>No library yet</EmptyTitle>
        <EmptyDescription>
          Pick a folder on this machine or connect a Plex, Jellyfin, or Navidrome server to start
          enjoying your karaoke!
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-lg flex-col justify-center gap-2 sm:flex-row sm:flex-wrap">
        <Button
          variant="outline"
          data-actions-index="0"
          className={actionClass(0)}
          onClick={() => setMode('plex-connect')}
          disabled={isPending}
        >
          <PlexIcon /> Connect Plex
        </Button>
        <Button
          variant="outline"
          data-actions-index="1"
          className={actionClass(1)}
          onClick={() => setMode('navidrome-connect')}
          disabled={isPending}
        >
          <Disc3Icon /> Connect Navidrome
        </Button>
        <Button
          variant="outline"
          data-actions-index="2"
          className={actionClass(2)}
          onClick={() => setMode('jellyfin-connect')}
          disabled={isPending}
        >
          <JellyfinIcon /> Connect Jellyfin
        </Button>
        <Button
          variant="outline"
          data-actions-index="3"
          className={actionClass(3)}
          onClick={() => selectFolder()}
          disabled={isPending}
        >
          <FolderIcon /> Select folder
        </Button>
      </EmptyContent>
      {focus.active && focus.source === 'nav' && (
        <p className="text-xs text-muted-foreground">←→ Choose source · OK Select</p>
      )}
    </Empty>
  );
};
