import {
  BUILT_IN_BACKGROUND_OPTIONS,
  backgroundOptionLabel,
  selectionKey,
} from '@/features/playback/components/theme';
import type { Translate } from '@/shared/i18n/translator';
import type { AppConfig } from '@/types/AppConfig';
import type { BackgroundSelection } from '@/types/BackgroundSelection';
import type { CustomBackground } from '@/types/CustomBackground';

type BackgroundOption = {
  value: string;
  label: string;
  description: string;
  selection: BackgroundSelection;
};

export function backgroundOptions(
  t: Translate,
  customBackgrounds: readonly CustomBackground[],
): BackgroundOption[] {
  return [
    ...BUILT_IN_BACKGROUND_OPTIONS.map((option) => ({
      value: selectionKey(option.selection),
      label: backgroundOptionLabel(t, option),
      description: t('background.builtIn'),
      selection: option.selection,
    })),
    ...customBackgrounds.map((background) => {
      const selection = { kind: 'custom' as const, id: background.id };
      return {
        value: selectionKey(selection),
        label: background.name,
        description: t('background.custom'),
        selection,
      };
    }),
  ];
}

export function initialBackgroundSelection(
  config: AppConfig,
  options: readonly BackgroundOption[],
): string {
  if (config.last_background !== null) {
    const selected = selectionKey(config.last_background);
    if (options.some((option) => option.value === selected)) {
      return selected;
    }
  }
  return options[config.last_theme ?? 0]?.value ?? options[0].value;
}
