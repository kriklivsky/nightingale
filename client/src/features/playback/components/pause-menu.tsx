import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import type { PlaybackVolumeControls } from '@/features/playback/hooks/use-playback-input';
import {
  usePlaybackMicActions,
  usePlaybackMicState,
  usePlaybackThemeActions,
  usePlaybackThemeState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { Kbd } from '@/shared/components/ui/kbd';
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';

import { flavorName, isPixabayTheme, themeName, type CycleStep } from './theme';

const VOLUME_STEP = 0.1;

type MenuRow = {
  id: string;
  label: string;
  value?: string;
  tone?: 'primary' | 'destructive';
  activate: () => void;
  adjust?: (step: CycleStep) => void;
};

const percentLabel = (value: number): string => `${Math.round(value * 100)}%`;

type PauseMenuProps = {
  open: boolean;
  exitLabel: string;
  volume: PlaybackVolumeControls;
};

function usePauseMenuRows({ exitLabel, volume }: Omit<PauseMenuProps, 'open'>): MenuRow[] {
  const { t } = useI18n();
  const { outputVolume, guideVolume, guideAvailable } = usePlaybackTransportState();
  const { handleContinue, handleRestart, handleExit } = usePlaybackTransportActions();
  const { multiplayer, micUserEnabled, micName, micMonitorUserEnabled } = usePlaybackMicState();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();
  const { theme, videoFlavor } = usePlaybackThemeState();
  const { cycleTheme, cycleFlavor } = usePlaybackThemeActions();
  const on = t('common.on');
  const off = t('common.off');

  const rows: MenuRow[] = [
    { id: 'continue', label: t('playback.continue'), tone: 'primary', activate: handleContinue },
    { id: 'restart', label: t('playback.restart'), activate: handleRestart },
    {
      id: 'volume',
      label: t('playback.volume'),
      value: percentLabel(outputVolume),
      activate: () => volume.applyOutputVolume(outputVolume + VOLUME_STEP),
      adjust: (step) => volume.applyOutputVolume(outputVolume + step * VOLUME_STEP),
    },
  ];
  if (guideAvailable) {
    rows.push({
      id: 'guide',
      label: t('playback.guideVocals'),
      value: guideVolume === 0 ? off : percentLabel(guideVolume),
      activate: () => volume.applyGuideVolume(guideVolume > 0 ? 0 : 0.3),
      adjust: (step) => volume.applyGuideVolume(guideVolume + step * VOLUME_STEP),
    });
  }
  if (!multiplayer) {
    rows.push(
      {
        id: 'mic',
        label: t('playback.microphone'),
        value: micUserEnabled ? on : off,
        activate: handleToggleMic,
        adjust: handleToggleMic,
      },
      {
        id: 'mic-device',
        label: t('playback.microphoneDevice'),
        value: micName,
        activate: handleCycleMic,
        adjust: handleCycleMic,
      },
    );
  }
  rows.push(
    {
      id: 'monitor',
      label: t('playback.monitoring'),
      value: micMonitorUserEnabled ? on : off,
      activate: handleToggleMicMonitor,
      adjust: handleToggleMicMonitor,
    },
    {
      id: 'background',
      label: t('playback.background'),
      value: themeName(t, theme, videoFlavor),
      activate: () => cycleTheme(1),
      adjust: cycleTheme,
    },
  );
  if (isPixabayTheme(theme)) {
    rows.push({
      id: 'flavor',
      label: t('playback.videoCollection'),
      value: flavorName(t, videoFlavor),
      activate: () => cycleFlavor(1),
      adjust: cycleFlavor,
    });
  }
  rows.push({ id: 'exit', label: exitLabel, tone: 'destructive', activate: handleExit });

  return rows;
}

function PauseMenuRow({ row, focused }: { row: MenuRow; focused: boolean }) {
  const { t } = useI18n();

  return (
    <li
      className={cn(
        'flex min-h-12 items-center gap-2 rounded-lg border border-transparent px-2',
        focused && 'border-primary bg-primary/10 ring-2 ring-primary',
      )}
    >
      <button
        type="button"
        onClick={row.activate}
        className={cn(
          'flex min-h-11 flex-1 items-center justify-between gap-4 rounded-md px-2 text-left text-lg',
          row.tone === 'primary' && 'font-semibold text-primary',
          row.tone === 'destructive' && 'text-destructive',
        )}
      >
        <span>{row.label}</span>
        {row.value !== undefined && (
          <span className="truncate text-base text-muted-foreground tabular-nums">{row.value}</span>
        )}
      </button>
      {row.adjust && (
        <span className="flex shrink-0 gap-1">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('playback.previousValue', { setting: row.label })}
            onClick={() => row.adjust?.(-1)}
            className="flex size-9 items-center justify-center rounded-md hover:bg-muted"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('playback.nextValue', { setting: row.label })}
            onClick={() => row.adjust?.(1)}
            className="flex size-9 items-center justify-center rounded-md hover:bg-muted"
          >
            <ChevronRightIcon className="size-5" />
          </button>
        </span>
      )}
    </li>
  );
}

/**
 * Pause screen doubling as the playback control center, so every setting that
 * has a hotkey is also reachable with only arrows, OK and Back on a TV remote.
 */
export const PauseMenu = ({ open, exitLabel, volume }: PauseMenuProps) => {
  const { t } = useI18n();
  const rows = usePauseMenuRows({ exitLabel, volume });
  const stops = useMemo(() => rows.map(() => 1), [rows]);

  const listRef = useRef<HTMLUListElement>(null);
  const { focusedIndex } = useDialogNav({
    open,
    itemCount: rows.length,
    stops,
    onConfirm: (index) => rows.at(index)?.activate(),
    onAction: (segment, _slot, action) => {
      const adjust = rows.at(segment)?.adjust;
      if (!adjust || (!action.left && !action.right)) {
        return false;
      }
      adjust(action.left ? -1 : 1);
      return true;
    },
    // Back resumes through the playback input handler, which owns pause state.
    onBack: () => {},
  });

  useEffect(() => {
    if (open) {
      listRef.current?.children.item(focusedIndex)?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex, open]);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="sm:max-w-xl" onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-2xl">{t('playback.paused')}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            {t('playback.exitLosesProgress')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul ref={listRef} className="no-scrollbar flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
          {rows.map((row, index) => (
            <PauseMenuRow key={row.id} row={row} focused={open && focusedIndex === index} />
          ))}
        </ul>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>
            <Kbd>↑↓</Kbd> {t('playback.hint.choose')}
          </span>
          <span>
            <Kbd>←→</Kbd> {t('playback.hint.change')}
          </span>
          <span>
            <Kbd>OK</Kbd> {t('playback.hint.select')}
          </span>
          <span>
            <Kbd>{t('playback.hint.backKey')}</Kbd> {t('playback.hint.resume')}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">{t('playback.hint.keyboard')}</p>
      </AlertDialogContent>
    </AlertDialog>
  );
};
