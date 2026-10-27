import {
  AlignLeftIcon,
  AudioLinesIcon,
  ImageIcon,
  LanguagesIcon,
  PencilLineIcon,
  RefreshCwIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react';

import type { Translate } from '@/shared/i18n/translator';
import type { Song } from '@/types/Song';

import type { SongStatusInfo } from '../song/song-status';
import type { ActionItemProps } from './action-item';

type AnalysisHandler = (fileHash: string) => void | Promise<void>;

type AnalysisHandlers = {
  enqueueOne: AnalysisHandler;
  cancelAnalysisOne: AnalysisHandler;
  deleteSongCache: AnalysisHandler;
  reanalyzeFull: AnalysisHandler;
  reanalyzeTranscript: AnalysisHandler;
  realign: AnalysisHandler;
  refreshMetadata: (fileHash: string) => Promise<boolean | undefined>;
};

type BuildActionGroupsParams = {
  song: Song;
  status: SongStatusInfo;
  analysisBusy: boolean;
  supportsAnalysisActions: boolean;
  analysis: AnalysisHandlers;
  onEditLyrics: () => void;
  onChangeLanguage: () => void;
  t: Translate;
  run: (
    message: string,
    action: () => void | boolean | undefined | Promise<void | boolean | undefined>,
    onFalse?: string,
  ) => () => Promise<void>;
};

export function buildActionGroups({
  song,
  status,
  analysisBusy,
  supportsAnalysisActions,
  analysis,
  onEditLyrics,
  onChangeLanguage,
  t,
  run,
}: BuildActionGroupsParams): ActionItemProps[][] {
  const groups: ActionItemProps[][] = [];

  const supportsProvideLyrics = song.transcript_source !== 'Usdx';

  if (status.isReady !== true) {
    const notReadyGroup: ActionItemProps[] = [
      analysisBusy
        ? {
            icon: XCircleIcon,
            title: t('songAction.cancelAnalysis'),
            description: t('songAction.cancelAnalysisDescription'),
            destructive: true,
            onClick: run(t('songAction.cancelledAnalysis', { title: song.title }), () =>
              analysis.cancelAnalysisOne(song.file_hash),
            ),
          }
        : {
            icon: AudioLinesIcon,
            title: t('songAction.analyze'),
            description: t('songAction.analyzeDescription'),
            onClick: () => analysis.enqueueOne(song.file_hash),
          },
    ];

    if (supportsProvideLyrics) {
      notReadyGroup.push({
        icon: PencilLineIcon,
        title: t('songAction.provideLyrics'),
        description: t('songAction.provideLyricsDescription'),
        disabled: analysisBusy,
        onClick: onEditLyrics,
      });
    }

    groups.push(notReadyGroup);
  }

  if (supportsAnalysisActions) {
    // LRC-provided songs can be edited or refreshed from LRCLIB.
    if (song.transcript_source === 'Lrc') {
      groups.push([
        {
          icon: PencilLineIcon,
          title: t('songAction.editLrc'),
          description: t('songAction.editLrcDescription'),
          onClick: onEditLyrics,
        },
        {
          icon: AudioLinesIcon,
          title: t('songAction.refreshLrclib'),
          description: t('songAction.refreshLrclibDescription'),
          onClick: run(t('songAction.refreshingLyrics', { title: song.title }), () =>
            analysis.reanalyzeFull(song.file_hash),
          ),
        },
      ]);
    } else {
      groups.push([
        {
          icon: AlignLeftIcon,
          title: t('songAction.realign'),
          description: t('songAction.realignDescription'),
          onClick: run(t('songAction.realigning', { title: song.title }), () =>
            analysis.realign(song.file_hash),
          ),
        },
        {
          icon: RefreshCwIcon,
          title: t('songAction.refetchLyrics'),
          description: t('songAction.refetchLyricsDescription'),
          onClick: run(t('songAction.refetchingLyrics', { title: song.title }), () =>
            analysis.reanalyzeTranscript(song.file_hash),
          ),
        },
        {
          icon: AudioLinesIcon,
          title: t('songAction.fullReanalysis'),
          description: t('songAction.fullReanalysisDescription'),
          onClick: run(t('songAction.fullReanalysisStarted', { title: song.title }), () =>
            analysis.reanalyzeFull(song.file_hash),
          ),
        },
      ]);

      groups.push([
        {
          icon: PencilLineIcon,
          title: t('songAction.editLyrics'),
          description: t('songAction.editLyricsDescription'),
          onClick: onEditLyrics,
        },
        {
          icon: LanguagesIcon,
          title: t('songAction.changeLanguage'),
          description: t('songAction.changeLanguageDescription'),
          onClick: onChangeLanguage,
        },
      ]);
    }

    if (!song.usdx) {
      groups.push([
        {
          icon: ImageIcon,
          title: t('songAction.refreshMetadata'),
          description: t('songAction.refreshMetadataDescription'),
          onClick: run(
            t('songAction.refreshedMetadata', { title: song.title }),
            () => analysis.refreshMetadata(song.file_hash),
            t('songAction.nothingToRefresh', { title: song.title }),
          ),
        },
      ]);
    }

    groups.push([
      {
        icon: Trash2Icon,
        title: t('songAction.deleteCache'),
        description: t('songAction.deleteCacheDescription'),
        destructive: true,
        onClick: run(t('songAction.cacheDeleted', { title: song.title }), () =>
          analysis.deleteSongCache(song.file_hash),
        ),
      },
    ]);
  }

  return groups;
}
