import { open } from '@tauri-apps/plugin-dialog';
import { z } from 'zod';

import type { AppConfig } from '@/types/AppConfig';
import type { CustomBackground } from '@/types/CustomBackground';

import { playbackAdapter } from './playback';
import { isTauri, invoke } from './runtime';
import { appConfigSchema } from './schemas';

const MAX_SHADER_BYTES = 256 * 1024;

const BACKGROUND_FILTER = {
  name: 'Supported backgrounds',
  extensions: ['jpg', 'jpeg', 'png', 'webp', 'glsl', 'frag', 'fs', 'mp4', 'webm'],
};

export const usesNativeBackgroundPicker = isTauri;

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

async function parseConfigResponse(response: Response): Promise<AppConfig> {
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `HTTP ${response.status}`);
  }
  return appConfigSchema.parse(await response.json());
}

export async function pickCustomBackgroundFile(): Promise<
  { path: string; name: string } | undefined
> {
  const path = await open({ multiple: false, filters: [BACKGROUND_FILTER] });
  return typeof path === 'string' ? { path, name: fileName(path) } : undefined;
}

export async function importCustomBackgroundFile(input: {
  name: string;
  file?: File;
  path?: string;
}): Promise<AppConfig> {
  if (isTauri) {
    if (input.path === undefined || input.path === '') {
      throw new Error('Choose a background file');
    }
    const value = await invoke('import_custom_background', {
      path: input.path,
      originalName: fileName(input.path),
      name: input.name,
    });
    return appConfigSchema.parse(value);
  }

  if (!input.file) {
    throw new Error('Choose a background file');
  }
  const form = new FormData();
  form.append('name', input.name);
  form.append('file', input.file);
  return parseConfigResponse(
    await fetch('/api/backgrounds/upload', {
      method: 'POST',
      body: form,
    }),
  );
}

export async function addCustomBackgroundUrl(input: {
  name: string;
  url: string;
}): Promise<AppConfig> {
  const value = await invoke('add_custom_background_url', input);
  return appConfigSchema.parse(value);
}

export async function removeCustomBackground(id: string): Promise<AppConfig> {
  const value = await invoke('remove_custom_background', { id });
  return appConfigSchema.parse(value);
}

export async function resolveCustomBackgroundUrl(background: CustomBackground): Promise<string> {
  if (background.source.kind === 'url') {
    return background.source.url;
  }
  const value = await invoke('resolve_custom_background_path', { id: background.id });
  const path = z.string().parse(value);
  await playbackAdapter.init();
  return playbackAdapter.toMediaUrl(path);
}

export async function loadCustomShaderSource(
  background: CustomBackground,
  signal?: AbortSignal,
): Promise<string> {
  if (background.background_type !== 'shader') {
    throw new Error('Custom background is not a shader');
  }
  if (background.source.kind === 'managed') {
    return z.string().parse(await invoke('load_custom_background_shader', { id: background.id }));
  }

  const response = await fetch(background.source.url, { signal });
  if (!response.ok) {
    throw new Error(`Shader request failed with HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_SHADER_BYTES) {
    await response.body?.cancel();
    throw new Error('Shader exceeds 256 KiB limit');
  }
  if (!response.body) {
    return '';
  }
  let receivedBytes = 0;
  const bounded = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > MAX_SHADER_BYTES) {
          throw new Error('Shader exceeds 256 KiB limit');
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(bounded).text();
}
