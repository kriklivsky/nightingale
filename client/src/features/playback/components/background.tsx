import { memo, useState } from 'react';
import { toast } from 'sonner';

import { usePlaybackMicActions } from '@/features/playback/providers/playback-mic-context';
import { usePlaybackThemeState } from '@/features/playback/providers/playback-theme-context';
import { usePlaybackTransportState } from '@/features/playback/providers/playback-transport-context';
import { useI18n } from '@/shared/i18n/use-i18n';

import { CustomBackground } from './custom-background';
import { PixabayVideo } from './pixabay-video';
import { ShaderVisualizer } from './shader-visualizer';
import { SourceVideo } from './source-video';

function ShaderBranch({ shaderIndex, isPlaying }: { shaderIndex: number; isPlaying: boolean }) {
  const { reactiveRef } = usePlaybackMicActions();
  return (
    <ShaderVisualizer shaderIndex={shaderIndex} isPlaying={isPlaying} reactiveRef={reactiveRef} />
  );
}

function CustomBranch({ isPlaying }: { isPlaying: boolean }) {
  const { theme } = usePlaybackThemeState();
  const { reactiveRef } = usePlaybackMicActions();
  const { t } = useI18n();
  if (theme.kind !== 'custom') {
    return null;
  }
  return (
    <CustomBackground
      key={theme.background.id}
      background={theme.background}
      isPlaying={isPlaying}
      reactiveRef={reactiveRef}
      onError={(message) => toast.error(t('playback.backgroundError', { detail: message }))}
    />
  );
}

function BackgroundImpl() {
  const { isReady, isPlaying } = usePlaybackTransportState();
  const { theme, videoFlavor, sourceVideoPath } = usePlaybackThemeState();
  const [videoCovers, setVideoCovers] = useState(false);

  return (
    <div className="fixed inset-0">
      {theme.kind === 'source' && !videoCovers && (
        <ShaderBranch shaderIndex={0} isPlaying={isPlaying} />
      )}
      {typeof sourceVideoPath === 'string' && sourceVideoPath !== '' && (
        <SourceVideo
          isActive={isReady && theme.kind === 'source'}
          onCoverageChange={setVideoCovers}
        />
      )}
      {theme.kind === 'shader' && (
        <ShaderBranch shaderIndex={theme.shaderIndex} isPlaying={isPlaying} />
      )}
      {theme.kind === 'pixabay' && <PixabayVideo flavor={videoFlavor} isPlaying={isPlaying} />}
      {theme.kind === 'custom' && <CustomBranch isPlaying={isPlaying} />}
    </div>
  );
}

export const Background = memo(BackgroundImpl);
