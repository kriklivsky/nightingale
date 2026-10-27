import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import {
  reservePlaybackTarget,
  savePlaybackSession,
  showPlaybackTarget,
  type PlaybackSession,
  type PlaybackTarget,
} from '@/bridge/playback-session';
import { useConfig } from '@/shared/config/use-config';
import { useI18n } from '@/shared/i18n/use-i18n';

export function usePlaybackLauncher() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { data: config } = useConfig();
  const sessionMode = config?.playback_mode === 'session';

  const reserveTarget = useCallback((): PlaybackTarget => {
    const target = sessionMode ? reservePlaybackTarget() : null;
    if (target === undefined) {
      toast.error(t('playback.allowPopups'));
    }
    return target;
  }, [sessionMode, t]);

  const launch = useCallback(
    async (session: PlaybackSession, target: PlaybackTarget): Promise<void> => {
      try {
        if (!sessionMode) {
          await navigate('/playback', { replace: session.queuePlayback, state: session });
          return;
        }

        await savePlaybackSession(session);
        await showPlaybackTarget(target);
      } catch (error) {
        target?.close();
        toast.error(
          t('playback.startFailed', {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
    [navigate, sessionMode, t],
  );

  return { launch, reserveTarget, sessionMode };
}
