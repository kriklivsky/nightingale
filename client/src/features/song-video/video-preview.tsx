import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { playbackAdapter } from '@/bridge/playback';
import type { SongVideo } from '@/bridge/song-video';
import { Button } from '@/shared/components/ui/button';
import { useConfig } from '@/shared/config/use-config';
import { useSourceVideoSync } from '@/shared/hooks/use-source-video-sync';
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';
import type { Song } from '@/types/Song';

import { usePreviewAudio } from './use-preview-audio';

type VideoPreviewProps = { song: Song; video: SongVideo; offsetSec: number };

function previewError(
  t: Translate,
  audioError: string | null,
  videoError: string | null,
  urlError: unknown,
): string | null {
  if (audioError !== null) {
    return audioError;
  }
  if (videoError !== null) {
    return videoError;
  }
  return urlError instanceof Error ? t('video.previewFailed') : null;
}

function useVideoPreview({ song, video, offsetSec }: VideoPreviewProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const { data: config } = useConfig();
  const { data: urls, error: urlError } = useQuery({
    queryKey: ['song-video-preview', song.file_hash, video.path],
    queryFn: async () => {
      await playbackAdapter.init();
      return {
        audio: playbackAdapter.toMediaUrl(song.usdx?.audio ?? song.path),
        video: playbackAdapter.toMediaUrl(video.path),
      };
    },
    retry: false,
  });
  const audio = usePreviewAudio(urls?.audio, config?.output_volume ?? 1);
  const { ready, visible } = useSourceVideoSync({
    videoRef,
    src: urls?.video ?? null,
    isPlaying: audio.playing,
    tempoRatio: 1,
    offsetSec,
    getCurrentTime: audio.getCurrentTime,
    subscribe: audio.subscribe,
  });
  const error = previewError(t, audio.error, videoError, urlError);

  return { videoRef, src: urls?.video, audio, ready, visible, error, setVideoError };
}

export function VideoPreview(props: VideoPreviewProps) {
  const { t } = useI18n();
  const { videoRef, src, audio, ready, visible, error, setVideoError } = useVideoPreview(props);

  return (
    <div className="space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          src={src}
          preload="auto"
          muted
          playsInline
          className="size-full object-contain"
          style={{ visibility: ready && visible ? 'visible' : 'hidden' }}
          onError={() => setVideoError(t('video.decodeFailed'))}
        />
        {!visible && (
          <p className="absolute inset-0 grid place-items-center text-sm text-white">
            {t('video.waitingFrame')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2" data-video-nav-row>
        <Button
          variant="outline"
          onClick={() => {
            void audio.toggle();
          }}
        >
          {audio.playing ? t('video.pausePreview') : t('video.playPreview')}
        </Button>
        <Button variant="outline" onClick={() => audio.seek(-10)}>
          {t('video.seconds', { value: '−10' })}
        </Button>
        <Button variant="outline" onClick={() => audio.seek(10)}>
          {t('video.seconds', { value: '+10' })}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('video.previewTime', { value: audio.time.toFixed(1) })}
        </span>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
