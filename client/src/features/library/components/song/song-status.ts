import { ANALYSIS_STATUS_STYLES } from '@/features/library/lib/analysis-status-styles';
import type { MessageKey, Translate } from '@/shared/i18n/translator';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

export type SongStatusInfo = {
  labelKey: MessageKey;
  progress?: number;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className?: string;
  isAnalyzing?: boolean;
  isReady?: boolean;
};

export function transcriptSourceKey(source: Song['transcript_source']): MessageKey {
  if (source === 'Lyrics') {
    return 'transcript.aligned';
  }
  if (source === 'Usdx') {
    return 'transcript.usdx';
  }
  if (source === 'Lrc') {
    return 'transcript.lrc';
  }
  return 'transcript.generated';
}

export function songStatusLabel(t: Translate, status: SongStatusInfo): string {
  return t(status.labelKey, { progress: status.progress ?? 0 });
}

export function getSongStatusInfo(isAnalyzed: boolean, queueStatus?: QueuedStatus): SongStatusInfo {
  if (queueStatus === 'Queued') {
    return {
      labelKey: 'status.queued',
      variant: 'secondary',
      className: ANALYSIS_STATUS_STYLES.queued,
    };
  }

  if (typeof queueStatus === 'object') {
    if ('Analyzing' in queueStatus) {
      return {
        labelKey: 'status.analyzingProgress',
        progress: queueStatus.Analyzing,
        variant: 'default',
        className: `${ANALYSIS_STATUS_STYLES.analysing} animate-pulse motion-reduce:animate-none`,
        isAnalyzing: true,
      };
    }
    if ('Failed' in queueStatus) {
      return {
        labelKey: queueStatus.Failed.startsWith('No synchronized lyrics found')
          ? 'status.noTimedLyrics'
          : 'status.failed',
        variant: 'destructive',
      };
    }
  }

  if (isAnalyzed) {
    return {
      labelKey: 'status.ready',
      variant: 'default',
      className: ANALYSIS_STATUS_STYLES.analysed,
      isReady: true,
    };
  }

  return { labelKey: 'status.notAnalyzed', variant: 'outline' };
}
