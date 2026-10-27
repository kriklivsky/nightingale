import { Disc3Icon, FolderIcon, RefreshCwIcon } from 'lucide-react';
import { useMemo, type ComponentType, type SVGProps } from 'react';

import type { BadgeTone } from '@/features/menu/components/sidebar/source-action-button';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useLibrarySourceActions } from '@/features/sources/hooks/use-library-source-actions';
import { JellyfinIcon } from '@/shared/components/icons/jellyfin';
import { PlexIcon } from '@/shared/components/icons/plex';
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';

export type SourceButton = {
  key: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  tooltip: string;
  handler: () => void;
  disabled: boolean;
  badge?: BadgeTone;
};

type RemoteBadgeInput = {
  t: Translate;
  label: string;
  baseUrl: string | undefined;
  health: { reachable: boolean; server_name?: string; error?: string } | undefined;
};

/**
 * Reduces a remote source's `(connected? health?)` state into the tooltip
 * text and badge tone for its sidebar button. Shared by both Jellyfin and
 * Navidrome so the wording stays consistent and adding another remote
 * source costs one call instead of a new copy of the branch ladder.
 */
const remoteBadge = ({
  t,
  label,
  baseUrl,
  health,
}: RemoteBadgeInput): { tooltip: string; badge?: BadgeTone } => {
  if (typeof baseUrl !== 'string' || baseUrl === '') {
    return { tooltip: t('source.connect', { source: label }) };
  }
  const host = health?.server_name ?? baseUrl.replace(/^https?:\/\//, '');
  if (!health) {
    return { tooltip: t('source.checking', { host }), badge: 'muted' };
  }
  if (health.reachable) {
    return { tooltip: t('source.connected', { host }), badge: 'ok' };
  }
  return {
    tooltip:
      typeof health.error === 'string' && health.error !== ''
        ? t('source.offlineWithError', { host, error: health.error })
        : t('source.offline', { host }),
    badge: 'warn',
  };
};

/**
 * Derives the ordered list of Library-cluster buttons (Jellyfin, Navidrome,
 * Folder, Rescan) along with their dynamic state — most notably the remote
 * connection badges + tooltips driven by their respective health hooks.
 * Centralising this keeps `FolderActions` focused on layout + focus
 * management.
 */
export const useSourceButtons = (): SourceButton[] => {
  const { t } = useI18n();
  const { setMode } = useDialog();
  const {
    selectFolder,
    rescan,
    rescanDisabled,
    isPending,
    hasSource,
    libraryPinned,
    jellyfinSource,
    navidromeSource,
    plexSource,
    jellyfinHealth,
    navidromeHealth,
    plexHealth,
  } = useLibrarySourceActions();

  const jellyfin = useMemo(
    () =>
      remoteBadge({
        t,
        label: 'Jellyfin',
        baseUrl: jellyfinSource?.base_url,
        health: jellyfinHealth,
      }),
    [jellyfinSource, jellyfinHealth, t],
  );

  const navidrome = useMemo(
    () =>
      remoteBadge({
        t,
        label: 'Navidrome',
        baseUrl: navidromeSource?.base_url,
        health: navidromeHealth,
      }),
    [navidromeSource, navidromeHealth, t],
  );

  const plex = useMemo(
    () =>
      remoteBadge({
        t,
        label: 'Plex',
        baseUrl: plexSource?.base_url,
        health: plexHealth,
      }),
    [plexSource, plexHealth, t],
  );

  return useMemo<SourceButton[]>(() => {
    // Operator pinned the library folder: source switching is disabled, only
    // the rescan action stays available.
    const buttons: SourceButton[] = libraryPinned
      ? []
      : [
          {
            key: 'plex',
            icon: PlexIcon,
            label: t('empty.connectPlex'),
            tooltip: plex.tooltip,
            handler: () => setMode('plex-connect'),
            disabled: isPending,
            badge: plex.badge,
          },
          {
            key: 'navidrome',
            icon: Disc3Icon,
            label: t('empty.connectNavidrome'),
            tooltip: navidrome.tooltip,
            handler: () => setMode('navidrome-connect'),
            disabled: isPending,
            badge: navidrome.badge,
          },
          {
            key: 'jellyfin',
            icon: JellyfinIcon,
            label: t('empty.connectJellyfin'),
            tooltip: jellyfin.tooltip,
            handler: () => setMode('jellyfin-connect'),
            disabled: isPending,
            badge: jellyfin.badge,
          },
          {
            key: 'folder',
            icon: FolderIcon,
            label: t('empty.selectFolder'),
            tooltip: t('empty.selectFolder'),
            handler: hasSource ? () => setMode('folder-source-confirm') : selectFolder,
            disabled: isPending,
          },
        ];

    if (hasSource) {
      buttons.push({
        key: 'rescan',
        icon: RefreshCwIcon,
        label: t('empty.rescan'),
        tooltip: t('source.rescanTooltip'),
        handler: rescan,
        disabled: rescanDisabled,
      });
    }

    return buttons;
  }, [
    hasSource,
    libraryPinned,
    isPending,
    jellyfin,
    navidrome,
    plex,
    rescan,
    rescanDisabled,
    selectFolder,
    setMode,
    t,
  ]);
};
