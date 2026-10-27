import { LoaderCircleIcon } from 'lucide-react';

import { useSongsMeta } from '@/features/library/queries/use-songs';
import { Progress as ShadCnProgress } from '@/shared/components/ui/progress';
import { useConfig } from '@/shared/config/use-config';
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import type { LibrarySource } from '@/types/LibrarySource';

function sourceLabel(t: Translate, source: LibrarySource | null | undefined): string {
  switch (source?.kind) {
    case 'jellyfin':
      return 'Jellyfin';
    case 'navidrome':
      return 'Navidrome';
    case 'plex':
      return 'Plex Media Server';
    case 'folder':
      return t('library.source.folder');
    case undefined: {
      throw new Error('Not implemented yet: undefined case');
    }
    default:
      return t('library.source.library');
  }
}

export const LibraryProgress = () => {
  const { t } = useI18n();
  const { data: meta } = useSongsMeta();
  const { data: config } = useConfig();

  if (!meta) {
    return null;
  }

  const { count, processed_count, folder } = meta;
  const source = config?.library_source;

  // Pre-first-page window: scan kicked off (folder label set) but the source
  // hasn't told us how big the catalogue is yet, so the determinate bar
  // would be `max=0`. A local scan can legitimately finish empty in this
  // state, while remote sources still have an initial catalogue round-trip.
  if (folder && count === 0 && processed_count === 0) {
    if (source?.kind === 'folder') {
      return null;
    }

    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <LoaderCircleIcon className="size-3 animate-spin motion-reduce:animate-none" />
        {t('library.connecting', { source: sourceLabel(t, source) })}
      </div>
    );
  }

  if (count === processed_count) {
    return null;
  }

  return <ShadCnProgress max={count} value={processed_count} />;
};
