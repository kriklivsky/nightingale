import { LoaderCircleIcon } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

import { getSongStatusInfo, songStatusLabel, transcriptSourceKey } from './song-status';

export function StatusBadge({ song, queueStatus }: { song: Song; queueStatus?: QueuedStatus }) {
  const { t } = useI18n();
  const status = getSongStatusInfo(song.is_analyzed, queueStatus);
  const source =
    status.isReady === true ? ` (${t(transcriptSourceKey(song.transcript_source))})` : '';

  return (
    <Badge variant={status.variant} className={cn('border-foreground/15', status.className)}>
      {status.isAnalyzing === true ? (
        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
      ) : null}
      {songStatusLabel(t, status)}
      {source}
    </Badge>
  );
}
