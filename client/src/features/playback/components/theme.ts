import { FLAVORS, type VideoFlavor } from '@/features/playback/lib/video-flavor';
import type { MessageKey, Translate } from '@/shared/i18n/translator';
import type { BackgroundSelection } from '@/types/BackgroundSelection';
import type { CustomBackground } from '@/types/CustomBackground';

import { shaders } from './shaders';

export type PlaybackTheme =
  | { kind: 'shader'; id: string; name: string; shaderIndex: number }
  | { kind: 'pixabay' }
  | { kind: 'source' }
  | { kind: 'custom'; background: CustomBackground };

export type CycleStep = 1 | -1;

export type BuiltInBackgroundOption = {
  selection: BackgroundSelection;
  shaderId: string | null;
  label: string;
};

function unreachable(value: never): never {
  throw new Error(`Unknown background variant: ${JSON.stringify(value)}`);
}

export const BUILT_IN_BACKGROUND_OPTIONS: BuiltInBackgroundOption[] = [
  ...shaders.map((shader) => ({
    selection: { kind: 'built_in_shader' as const, id: shader.id },
    shaderId: shader.id,
    label: shader.name,
  })),
  { selection: { kind: 'pixabay' }, shaderId: null, label: 'Pixabay' },
];

const SHADER_NAME_KEYS: ReadonlyMap<string, MessageKey> = new Map([
  ['plasma', 'theme.shader.plasma'],
  ['waves', 'theme.shader.waves'],
  ['nebula', 'theme.shader.nebula'],
  ['starfield', 'theme.shader.starfield'],
  ['sonar', 'theme.shader.sonar'],
  ['voronoi', 'theme.shader.voronoi'],
  ['vortex', 'theme.shader.vortex'],
  ['metaballs', 'theme.shader.metaballs'],
  ['spectrum', 'theme.shader.spectrum'],
  ['oscilloscope', 'theme.shader.oscilloscope'],
]);

const FLAVOR_NAME_KEYS: Readonly<Record<VideoFlavor, MessageKey>> = {
  nature: 'theme.flavor.nature',
  underwater: 'theme.flavor.underwater',
  space: 'theme.flavor.space',
  city: 'theme.flavor.city',
  countryside: 'theme.flavor.countryside',
};

export function shaderName(t: Translate, id: string, fallback: string): string {
  const key = SHADER_NAME_KEYS.get(id);
  return key === undefined ? fallback : t(key);
}

export function flavorName(t: Translate, flavor: VideoFlavor): string {
  return t(FLAVOR_NAME_KEYS[flavor]);
}

export function backgroundOptionLabel(t: Translate, option: BuiltInBackgroundOption): string {
  return option.shaderId === null
    ? t('theme.pixabayVideo')
    : shaderName(t, option.shaderId, option.label);
}

export function themeKey(theme: PlaybackTheme): string {
  switch (theme.kind) {
    case 'shader':
      return `shader:${theme.id}`;
    case 'pixabay':
      return 'pixabay';
    case 'source':
      return 'source';
    case 'custom':
      return `custom:${theme.background.id}`;
    default:
      return unreachable(theme);
  }
}

export function selectionKey(selection: BackgroundSelection): string {
  switch (selection.kind) {
    case 'built_in_shader':
      return `shader:${selection.id}`;
    case 'pixabay':
      return 'pixabay';
    case 'custom':
      return `custom:${selection.id}`;
    default:
      return unreachable(selection);
  }
}

export function createPlaybackThemes(
  customBackgrounds: readonly CustomBackground[],
  hasSourceVideo: boolean,
): PlaybackTheme[] {
  return [
    ...shaders.map<PlaybackTheme>((shader, shaderIndex) => ({
      kind: 'shader',
      id: shader.id,
      name: shader.name,
      shaderIndex,
    })),
    { kind: 'pixabay' },
    ...(hasSourceVideo ? ([{ kind: 'source' }] satisfies PlaybackTheme[]) : []),
    ...customBackgrounds.map<PlaybackTheme>((background) => ({ kind: 'custom', background })),
  ];
}

export function initialThemeKey(input: {
  themes: readonly PlaybackTheme[];
  hasSourceVideo: boolean;
  selection: BackgroundSelection | null | undefined;
  legacyIndex: number;
}): string {
  if (input.hasSourceVideo) {
    return 'source';
  }
  if (input.selection !== null && input.selection !== undefined) {
    const selected = selectionKey(input.selection);
    if (input.themes.some((theme) => themeKey(theme) === selected)) {
      return selected;
    }
  }
  if (input.legacyIndex >= 0 && input.legacyIndex < input.themes.length) {
    const legacy = input.themes[input.legacyIndex];
    if (legacy.kind !== 'source') {
      return themeKey(legacy);
    }
  }
  return themeKey(input.themes[0]);
}

export function selectionForTheme(theme: PlaybackTheme): BackgroundSelection | null {
  switch (theme.kind) {
    case 'shader':
      return { kind: 'built_in_shader', id: theme.id };
    case 'pixabay':
      return { kind: 'pixabay' };
    case 'custom':
      return { kind: 'custom', id: theme.background.id };
    case 'source':
      return null;
    default:
      return unreachable(theme);
  }
}

export function themeName(t: Translate, theme: PlaybackTheme, videoFlavor: VideoFlavor): string {
  switch (theme.kind) {
    case 'source':
      return t('theme.sourceVideo');
    case 'pixabay':
      return t('theme.video', { flavor: flavorName(t, videoFlavor) });
    case 'shader':
      return shaderName(t, theme.id, theme.name);
    case 'custom':
      return theme.background.name;
    default:
      return unreachable(theme);
  }
}

export function nextThemeKey(
  themes: readonly PlaybackTheme[],
  current: string,
  step: CycleStep,
): string {
  const currentIndex = themes.findIndex((theme) => themeKey(theme) === current);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + step + themes.length) % themes.length;
  return themeKey(themes[nextIndex]);
}

export function nextFlavorIndex(current: number, step: CycleStep): number {
  return (current + step + FLAVORS.length) % FLAVORS.length;
}

export function isPixabayTheme(theme: PlaybackTheme): boolean {
  return theme.kind === 'pixabay';
}
