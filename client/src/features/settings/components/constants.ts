import { DEFAULT_PLAYBACK_SCALE } from '@/features/playback/lib/display-scale';
import {
  DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  MAX_MIC_LATENCY_COMPENSATION_SEC,
} from '@/features/playback/lib/pitch/constants';
import type { AppConfig } from '@/types/AppConfig';

export { PLAYBACK_SCALE_MAX, PLAYBACK_SCALE_MIN } from '@/features/playback/lib/display-scale';

export type SettingsTab = 'general' | 'playback' | 'analysis';
export type SettingsOption = { value: string; label: string; description?: string };

export const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'playback', label: 'Playback' },
  { value: 'analysis', label: 'Analysis' },
];

export const SEPARATORS: SettingsOption[] = [
  {
    value: 'karaoke',
    label: 'UVR Karaoke',
    description: 'Usually separates more cleanly, but can occasionally slip on tricky parts.',
  },
  {
    value: 'demucs',
    label: 'Demucs',
    description:
      'Smoother and more consistent with fewer abrupt artifacts, though slightly less crisp overall.',
  },
];

export const ALIGN_BACKENDS: SettingsOption[] = [
  {
    value: 'whisperx',
    label: 'WhisperX',
    description: 'The reliable default, timing words with a proven decoder.',
  },
  {
    value: 'ctc',
    label: 'CTC Forced Alignment (Experimental)',
    description:
      'Calculates word start/end points with a different algorithm, and runs much faster on GPU and Apple Silicon. Falls back to WhisperX if a line trips it up.',
  },
  {
    value: 'qwen',
    label: 'Qwen Forced Alignment (Experimental)',
    description:
      'A fast AI model covering 11 languages. Timing quality varies song to song, but it can do better on Chinese, Japanese, and Korean. Falls back to WhisperX otherwise.',
  },
];

export const PLAYBACK_MODES: SettingsOption[] = [
  {
    value: 'classic',
    label: 'Classic mode',
    description: 'Playback replaces the menu in the current window.',
  },
  {
    value: 'session',
    label: 'Session mode',
    description: 'Playback uses a separate window while the menu manages the queue.',
  },
];

export const LYRICS_VERTICAL_POSITIONS: SettingsOption[] = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
];

export const LYRICS_HORIZONTAL_POSITIONS: SettingsOption[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

export const DEFAULTS = {
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
} satisfies Pick<
  AppConfig,
  | 'separator'
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
    microphone: 2,
    micMonitorGain: 3,
    micLatency: 4,
    micLatencyTest: 5,
    micTest: 6,
  },
  playback: {
    mode: 1,
    lyricsVerticalPosition: 2,
    lyricsHorizontalPosition: 3,
    lyricsScale: 4,
    pitchGraphScale: 5,
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

export function getSettingsStops(tab: SettingsTab) {
  if (tab === 'general') {
    return [3, 2, 1, 1, 1, 1, 2, 2];
  }
  if (tab === 'playback') {
    return [3, 1, 1, 1, 1, 1, 2];
  }

  return [3, 1, 1, 2, 1, 2];
}
