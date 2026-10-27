import { DEFAULT_PLAYBACK_SCALE } from '@/features/playback/lib/display-scale';
import {
  DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  MAX_MIC_LATENCY_COMPENSATION_SEC,
} from '@/features/playback/lib/pitch/constants';
import type { MessageKey, Translate, UiLanguageSetting } from '@/shared/i18n/translator';
import type { AppConfig } from '@/types/AppConfig';

export { PLAYBACK_SCALE_MAX, PLAYBACK_SCALE_MIN } from '@/features/playback/lib/display-scale';

export type SettingsTab = 'general' | 'playback' | 'analysis';
export type SettingsOption = { value: string; label: string; description?: string };
type SettingsOptionDefinition = {
  value: string;
  labelKey: MessageKey;
  descriptionKey?: MessageKey;
};

export const localizeOptions = (
  t: Translate,
  options: readonly SettingsOptionDefinition[],
): SettingsOption[] =>
  options.map(({ value, labelKey, descriptionKey }) => ({
    value,
    label: t(labelKey),
    ...(descriptionKey === undefined ? {} : { description: t(descriptionKey) }),
  }));

export const SETTINGS_TABS: { value: SettingsTab; labelKey: MessageKey }[] = [
  { value: 'general', labelKey: 'settings.tab.general' },
  { value: 'playback', labelKey: 'settings.tab.playback' },
  { value: 'analysis', labelKey: 'settings.tab.analysis' },
];

export const SEPARATORS: SettingsOptionDefinition[] = [
  {
    value: 'karaoke',
    labelKey: 'settings.separator.karaoke',
    descriptionKey: 'settings.separator.karaokeDescription',
  },
  {
    value: 'demucs',
    labelKey: 'settings.separator.demucs',
    descriptionKey: 'settings.separator.demucsDescription',
  },
];

export const ALIGN_BACKENDS: SettingsOptionDefinition[] = [
  {
    value: 'whisperx',
    labelKey: 'settings.align.whisperx',
    descriptionKey: 'settings.align.whisperxDescription',
  },
  {
    value: 'ctc',
    labelKey: 'settings.align.ctc',
    descriptionKey: 'settings.align.ctcDescription',
  },
  {
    value: 'qwen',
    labelKey: 'settings.align.qwen',
    descriptionKey: 'settings.align.qwenDescription',
  },
];

export const PLAYBACK_MODES: SettingsOptionDefinition[] = [
  {
    value: 'classic',
    labelKey: 'settings.mode.classic',
    descriptionKey: 'settings.mode.classicDescription',
  },
  {
    value: 'session',
    labelKey: 'settings.mode.session',
    descriptionKey: 'settings.mode.sessionDescription',
  },
];

export const LYRICS_VERTICAL_POSITIONS: SettingsOptionDefinition[] = [
  { value: 'bottom', labelKey: 'settings.position.bottom' },
  { value: 'center', labelKey: 'settings.position.center' },
  { value: 'top', labelKey: 'settings.position.top' },
];

export const LYRICS_HORIZONTAL_POSITIONS: SettingsOptionDefinition[] = [
  { value: 'left', labelKey: 'settings.position.left' },
  { value: 'center', labelKey: 'settings.position.center' },
  { value: 'right', labelKey: 'settings.position.right' },
];

export const LYRICS_ROMANIZATION_MODES: SettingsOptionDefinition[] = [
  { value: 'enabled', labelKey: 'settings.enabled' },
  { value: 'disabled', labelKey: 'settings.disabled' },
];

export const PITCH_DISPLAYS: SettingsOptionDefinition[] = [
  { value: 'lane', labelKey: 'settings.pitchDisplay.lane' },
  { value: 'meter', labelKey: 'settings.pitchDisplay.meter' },
];

export const UI_LANGUAGES: readonly { value: UiLanguageSetting; labelKey: MessageKey }[] = [
  { value: 'system', labelKey: 'settings.language.system' },
  { value: 'en', labelKey: 'settings.language.en' },
  { value: 'ru', labelKey: 'settings.language.ru' },
];

export const DEFAULTS = {
  combine_multi_channel: true,
  multiplayer_combine_multi_channel: true,
  output_volume: 1,
  lyrics_romanization_mode: 'enabled',
  separator: 'karaoke',
  asr_engine: 'whisper',
  align_backend: 'whisperx',
  vocal_detection_threshold_pct: 0.15,
  whisper_model: 'large-v3',
  beam_size: 8,
  batch_size: 8,
  mic_monitor_gain: 0.65,
  mic_latency_compensation_sec: DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  auto_analyze: false,
  playback_mode: 'classic',
  lyrics_vertical_position: 'bottom',
  lyrics_horizontal_position: 'center',
  lyrics_scale: DEFAULT_PLAYBACK_SCALE,
  pitch_graph_scale: DEFAULT_PLAYBACK_SCALE,
  pitch_display: 'lane',
} satisfies Pick<
  AppConfig,
  | 'separator'
  | 'combine_multi_channel'
  | 'multiplayer_combine_multi_channel'
  | 'output_volume'
  | 'lyrics_romanization_mode'
  | 'asr_engine'
  | 'align_backend'
  | 'vocal_detection_threshold_pct'
  | 'whisper_model'
  | 'beam_size'
  | 'batch_size'
  | 'mic_monitor_gain'
  | 'mic_latency_compensation_sec'
  | 'auto_analyze'
  | 'playback_mode'
  | 'lyrics_vertical_position'
  | 'lyrics_horizontal_position'
  | 'lyrics_scale'
  | 'pitch_graph_scale'
  | 'pitch_display'
>;

export const MIC_MONITOR_GAIN_STEP = 0.01;
export const MIC_MONITOR_GAIN_MAX = 2;
export const MIC_LATENCY_STEP = 0.005;
export const MIC_LATENCY_MAX = MAX_MIC_LATENCY_COMPENSATION_SEC;
export const PLAYBACK_SCALE_STEP = 0.05;
// Vocal-detection threshold is stored as a fraction of peak RMS (0-1) but shown
// as a percentage. Capped at 60% since anything higher trims almost everything.
export const VOCAL_THRESHOLD_STEP = 0.01;
export const VOCAL_THRESHOLD_MIN = 0;
export const VOCAL_THRESHOLD_MAX = 0.6;

export const NAV = {
  tabSegment: 0,
  general: {
    window: 1,
    language: 2,
    microphone: 3,
    micMonitorGain: 4,
    micLatency: 5,
    micLatencyTest: 6,
    micTest: 7,
  },
  playback: {
    background: 1,
    mode: 2,
    masterVolume: 3,
    lyricsVerticalPosition: 4,
    lyricsHorizontalPosition: 5,
    lyricsScale: 6,
    pitchDisplay: 7,
    pitchGraphScale: 8,
    lyricsRomanizationMode: 9,
  },
} as const;

export function getAnalysisNav() {
  return {
    separator: 1,
    alignBackend: 2,
    autoAnalyze: 3,
    vocalThreshold: 4,
  };
}

export function getSettingsStops(tab: SettingsTab, hasMultiChannelInput: boolean) {
  if (tab === 'general') {
    return [3, 2, 3, hasMultiChannelInput ? 2 : 1, 1, 1, 1, 2, 2];
  }
  if (tab === 'playback') {
    return [3, 2, 1, 1, 1, 1, 1, 2, 1, 2, 2];
  }

  return [3, 1, 1, 2, 1, 2];
}
