import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { playbackAdapter } from '@/bridge/playback';
import type { SongVideo } from '@/bridge/song-video';
import { Button } from '@/shared/components/ui/button';
import { useConfig } from '@/shared/config/use-config';
import { useSourceVideoSync } from '@/shared/hooks/use-source-video-sync';
import type { Song } from '@/types/Song';

import { usePreviewAudio } from './use-preview-audio';

type VideoPreviewProps = { song: Song; video: SongVideo; offsetSec: number };

function previewError(
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
  return urlError instanceof Error ? 'Cannot open preview media.' : null;
}

function useVideoPreview({ song, video, offsetSec }: VideoPreviewProps) {
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
  const error = previewError(audio.error, videoError, urlError);

  return { videoRef, src: urls?.video, audio, ready, visible, error, setVideoError };
}

export function VideoPreview(props: VideoPreviewProps) {
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
          onError={() => setVideoError('Cannot decode the downloaded video. Try another clip.')}
        />
        {!visible && (
          <p className="absolute inset-0 grid place-items-center text-sm text-white">
            Waiting for the synchronized video frame
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
          {' '}
          {audio.playing ? 'Pause preview' : 'Play preview'}{' '}
        </Button>
        <Button variant="outline" onClick={() => audio.seek(-10)}>
          −10 s
        </Button>
        <Button variant="outline" onClick={() => audio.seek(10)}>
          +10 s
        </Button>
        <span className="text-sm text-muted-foreground">
          {audio.time.toFixed(1)} s · original song audio
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
