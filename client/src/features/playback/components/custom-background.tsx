import { useCallback, useEffect, useRef, useState } from 'react';

import { loadCustomShaderSource, resolveCustomBackgroundUrl } from '@/bridge/backgrounds';
import type { MicReactiveRef } from '@/features/microphone/hooks/use-mic-reactive';
import { customFragmentShader, validateCustomShader } from '@/features/playback/lib/custom-shader';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import type { CustomBackground as CustomBackgroundDefinition } from '@/types/CustomBackground';

import { ShaderVisualizer } from './shader-visualizer';

const SURFACE_CLASS = 'pointer-events-none absolute inset-0 size-full object-cover';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

function CustomVideo({
  src,
  playing,
  onError,
}: {
  src: string;
  playing: boolean;
  onError: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (video === null) {
      return;
    }
    if (playing) {
      void video.play().catch(onError);
    } else {
      video.pause();
    }
  }, [onError, playing]);

  return (
    <video
      ref={ref}
      aria-hidden="true"
      className={SURFACE_CLASS}
      src={src}
      preload="auto"
      loop
      muted
      playsInline
      onError={onError}
    />
  );
}

type CustomBackgroundProps = {
  background: CustomBackgroundDefinition;
  isPlaying: boolean;
  reactiveRef?: MicReactiveRef;
  onError?: (message: string) => void;
};

type BackgroundSurfaceProps = {
  background: CustomBackgroundDefinition;
  isPlaying: boolean;
  reactiveRef?: MicReactiveRef;
  reducedMotion: boolean;
  failed: boolean;
  shader: string | null;
  assetUrl: string | null;
  onMediaError: () => void;
};

function ReactiveShader({
  isPlaying,
  reducedMotion,
  reactiveRef,
  fragment,
}: {
  isPlaying: boolean;
  reducedMotion: boolean;
  reactiveRef?: MicReactiveRef;
  fragment?: string;
}) {
  return (
    <ShaderVisualizer
      shaderIndex={0}
      isPlaying={isPlaying && !reducedMotion}
      reactiveRef={reducedMotion ? undefined : reactiveRef}
      customFragment={fragment}
    />
  );
}

function BackgroundSurface({
  background,
  isPlaying,
  reactiveRef,
  reducedMotion,
  failed,
  shader,
  assetUrl,
  onMediaError,
}: BackgroundSurfaceProps) {
  if (failed) {
    return (
      <ReactiveShader
        isPlaying={isPlaying}
        reducedMotion={reducedMotion}
        reactiveRef={reactiveRef}
      />
    );
  }
  if (background.background_type === 'shader') {
    return shader !== null ? (
      <ReactiveShader
        isPlaying={isPlaying}
        reducedMotion={reducedMotion}
        reactiveRef={reactiveRef}
        fragment={shader}
      />
    ) : null;
  }
  if (assetUrl === null) {
    return null;
  }
  if (background.background_type === 'image') {
    return (
      <img
        aria-hidden="true"
        alt=""
        className={SURFACE_CLASS}
        src={assetUrl}
        draggable={false}
        onError={onMediaError}
      />
    );
  }
  return (
    <CustomVideo src={assetUrl} playing={isPlaying && !reducedMotion} onError={onMediaError} />
  );
}

export function CustomBackground({
  background,
  isPlaying,
  reactiveRef,
  onError,
}: CustomBackgroundProps) {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [shader, setShader] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const onErrorRef = useLatestRef(onError);
  const reducedMotion = useReducedMotion();
  const fail = useCallback(
    (message: string) => {
      setFailed(true);
      onErrorRef.current?.(message);
    },
    [onErrorRef],
  );

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      if (background.background_type === 'shader') {
        const source = await loadCustomShaderSource(background, controller.signal);
        const shaderError = validateCustomShader(source);
        if (shaderError !== undefined) {
          throw new Error(`Shader did not compile: ${shaderError}`);
        }
        if (!controller.signal.aborted) {
          setShader(customFragmentShader(source));
        }
        return;
      }
      const url = await resolveCustomBackgroundUrl(background);
      if (!controller.signal.aborted) {
        setAssetUrl(url);
      }
    };

    void load().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : 'Background could not be loaded';
        fail(message);
      }
    });

    return () => controller.abort();
  }, [background, fail]);

  const reportMediaError = useCallback(
    () => fail(`${background.name} could not be loaded`),
    [background.name, fail],
  );

  return (
    <BackgroundSurface
      background={background}
      isPlaying={isPlaying}
      reactiveRef={reactiveRef}
      reducedMotion={reducedMotion}
      failed={failed}
      shader={shader}
      assetUrl={assetUrl}
      onMediaError={reportMediaError}
    />
  );
}
