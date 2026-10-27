import { useEffect, useRef, useState } from 'react';

import {
  usePlaybackMicState,
  usePlaybackThemeState,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';

import { themeName } from './theme';

const OSD_VISIBLE_MS = 1600;

type OsdMessage = {
  label: string;
  value: string;
  level: number | null;
};

type OsdSnapshot = {
  outputVolume: number;
  guideVolume: number;
  micUserEnabled: boolean;
  micId: string | null;
  micName: string;
  micMonitorUserEnabled: boolean;
  background: string;
};

const percentLabel = (value: number): string => `${Math.round(value * 100)}%`;

/** The first setting that differs between two snapshots, as an on-screen message. */
function changedSetting(
  previous: OsdSnapshot,
  current: OsdSnapshot,
  t: Translate,
): OsdMessage | null {
  const onOff = (value: boolean) => (value ? t('common.on') : t('common.off'));
  const candidates: [boolean, () => OsdMessage][] = [
    [
      previous.outputVolume !== current.outputVolume,
      () => ({
        label: t('playback.volume'),
        value: percentLabel(current.outputVolume),
        level: current.outputVolume,
      }),
    ],
    [
      previous.guideVolume !== current.guideVolume,
      () => ({
        label: t('playback.guideVocals'),
        value: current.guideVolume === 0 ? t('common.off') : percentLabel(current.guideVolume),
        level: current.guideVolume,
      }),
    ],
    [
      previous.micUserEnabled !== current.micUserEnabled,
      () => ({
        label: t('playback.microphone'),
        value: onOff(current.micUserEnabled),
        level: null,
      }),
    ],
    [
      previous.micId !== current.micId,
      () => ({ label: t('playback.microphone'), value: current.micName, level: null }),
    ],
    [
      previous.micMonitorUserEnabled !== current.micMonitorUserEnabled,
      () => ({
        label: t('playback.monitoring'),
        value: onOff(current.micMonitorUserEnabled),
        level: null,
      }),
    ],
    [
      previous.background !== current.background,
      () => ({ label: t('playback.background'), value: current.background, level: null }),
    ],
  ];
  const changed = candidates.find(([differs]) => differs);
  return changed ? changed[1]() : null;
}

/**
 * Briefly confirms playback setting changes made with the remote or hotkeys
 * (volume, guide vocals, microphone, monitoring, background), which otherwise
 * give no visible feedback on a TV.
 */
export function PlaybackOsd() {
  const { t } = useI18n();
  const { outputVolume, guideVolume, paused } = usePlaybackTransportState();
  const { micUserEnabled, micName, selectedMicId, micMonitorUserEnabled } = usePlaybackMicState();
  const { theme, videoFlavor } = usePlaybackThemeState();
  const [message, setMessage] = useState<OsdMessage | null>(null);
  const background = themeName(t, theme, videoFlavor);
  const previousRef = useRef<OsdSnapshot | null>(null);

  useEffect(() => {
    const current: OsdSnapshot = {
      outputVolume,
      guideVolume,
      micUserEnabled,
      micId: selectedMicId,
      micName,
      micMonitorUserEnabled,
      background,
    };
    const previous = previousRef.current;
    previousRef.current = current;
    if (previous === null || paused) {
      return;
    }
    const changed = changedSetting(previous, current, t);
    if (changed !== null) {
      setMessage(changed);
    }
  }, [
    background,
    guideVolume,
    micMonitorUserEnabled,
    micName,
    micUserEnabled,
    outputVolume,
    paused,
    selectedMicId,
    t,
  ]);

  useEffect(() => {
    if (message === null) {
      return undefined;
    }
    const timer = window.setTimeout(() => setMessage(null), OSD_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (message === null || paused) {
    return null;
  }

  return (
    <output
      aria-live="polite"
      className="pointer-events-none absolute top-1/3 left-1/2 z-30 flex min-w-64 -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-2xl bg-black/75 px-6 py-4 text-white shadow-2xl"
    >
      <span className="flex items-baseline justify-between gap-6">
        <span className="text-lg text-white/80">{message.label}</span>
        <span className="text-2xl font-semibold tabular-nums">{message.value}</span>
      </span>
      {message.level !== null && (
        <span className="h-2 w-full overflow-hidden rounded-full bg-white/20" aria-hidden="true">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${Math.round(message.level * 100)}%` }}
          />
        </span>
      )}
    </output>
  );
}
