import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import successSoundUrl from '@/assets/sounds/success.mp3';
import type { PlaybackPlayer } from '@/bridge/playback-session';
import { addScores } from '@/bridge/profile';
import {
  usePlaybackQueueQuery,
  useStartNextPlaybackQueueSong,
} from '@/features/playback-queue/use-playback-queue';
import type { PitchReport } from '@/features/playback/lib/pitch/report';
import {
  usePlaybackMicState,
  usePlaybackMicActions,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { useI18n } from '@/shared/i18n/use-i18n';
import { defaultPlayerColor, type PlayerColor } from '@/shared/player-colors';
import { PROFILES } from '@/shared/query-keys';
import type { ProfileStore } from '@/types/ProfileStore';
import type { ScoreRecord } from '@/types/ScoreRecord';
import type { Song } from '@/types/Song';
import type { Segment } from '@/types/Transcript';

export type PlaybackPlayerResult = {
  id: string;
  profile: string | null;
  color: PlayerColor;
  score: number;
  report: PitchReport | null;
  /** True when this saved score beats the profile's earlier best for the song. */
  personalBest: boolean;
};

type FinalResultsInput = {
  multiplayer: boolean;
  players: ReturnType<typeof usePlaybackMicState>['players'];
  activeProfile: string | null;
  soloScore: number;
  soloReport: PitchReport;
  segments: readonly Segment[];
};

function buildFinalResults(input: FinalResultsInput): PlaybackPlayerResult[] {
  if (!input.multiplayer) {
    return [
      {
        id: 'solo',
        profile: input.activeProfile,
        color: defaultPlayerColor(0),
        score: input.soloScore,
        report: input.soloReport,
        personalBest: false,
      },
    ];
  }
  return input.players.map((player) => ({
    id: player.id,
    profile: player.profile,
    color: player.color,
    score: player.rawScore,
    report: player.getPitchReport(input.segments),
    personalBest: false,
  }));
}

function previousBest(
  scores: readonly ScoreRecord[],
  profile: string,
  songHash: string,
): number | null {
  let best: number | null = null;
  for (const record of scores) {
    if (record.profile === profile && record.song_hash === songHash) {
      best = best === null ? record.score : Math.max(best, record.score);
    }
  }
  return best;
}

function finishReady(
  isFinished: boolean,
  skipOutroPending: boolean,
  profilesLoading: boolean,
  alreadyHandled: boolean,
): boolean {
  return (isFinished || skipOutroPending) && !profilesLoading && !alreadyHandled;
}

export type PlaybackResult = {
  open: boolean;
  score: number;
  report: PitchReport | null;
  activeProfile: string | null;
  results: PlaybackPlayerResult[];
  scores: ScoreRecord[];
  nextPending: boolean;
  onBack: () => void;
  onNext?: (players?: readonly PlaybackPlayer[]) => void;
};

const EMPTY_PLAYERS: readonly PlaybackPlayer[] = [];
const EMPTY_PROFILES: ProfileStore = { active: null, profiles: [], scores: [] };

export function usePlaybackResult(
  song: Song,
  queuePlayback: boolean,
  players: readonly PlaybackPlayer[] = EMPTY_PLAYERS,
): PlaybackResult {
  const fileHash = song.file_hash;
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { data: profileData = EMPTY_PROFILES, isLoading: profilesLoading } = useProfiles();
  const { data: entries = [] } = usePlaybackQueueQuery();
  const { isPreparing, playNext } = useStartNextPlaybackQueueSong(entries);

  const { isFinished } = usePlaybackTransportState();
  const { handleExit } = usePlaybackTransportActions();
  const { rawScore, players: micPlayers, multiplayer } = usePlaybackMicState();
  const { getPitchReport } = usePlaybackMicActions();
  const { skipOutroPending, segments } = usePlaybackTranscriptState();
  const { clearSkipOutroPending } = usePlaybackTranscriptActions();

  const [showResult, setShowResult] = useState(false);
  const [results, setResults] = useState<PlaybackPlayerResult[]>([]);
  const micPlayersRef = useLatestRef(micPlayers);
  const scoreRef = useLatestRef(rawScore);
  const finishHandledRef = useRef(false);

  useEffect(() => {
    if (!finishReady(isFinished, skipOutroPending, profilesLoading, finishHandledRef.current)) {
      return;
    }

    finishHandledRef.current = true;
    clearSkipOutroPending();

    const finalResults = buildFinalResults({
      multiplayer,
      players: micPlayersRef.current,
      activeProfile: profileData.active,
      soloScore: scoreRef.current,
      soloReport: getPitchReport(segments),
      segments,
    });
    void (async () => {
      try {
        const savedScores = finalResults.flatMap((result) => {
          if (result.profile === null || !(multiplayer || queuePlayback || result.score > 0)) {
            return [];
          }
          return [[result.profile, result.score] satisfies readonly [string, number]];
        });
        for (const result of finalResults) {
          const saved = savedScores.some(([profile]) => profile === result.profile);
          const best =
            result.profile === null
              ? null
              : previousBest(profileData.scores, result.profile, fileHash);
          result.personalBest = saved && result.score > 0 && (best === null || result.score > best);
        }
        if (savedScores.length > 0) {
          await addScores(fileHash, savedScores);
          await queryClient.invalidateQueries({ queryKey: PROFILES });
        }
      } catch (error) {
        toast.error(
          t('playback.scoreSaveFailed', {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
        for (const result of finalResults) {
          result.personalBest = false;
        }
      }
      setResults(finalResults.toSorted((left, right) => right.score - left.score));
      setShowResult(true);
    })();
  }, [
    clearSkipOutroPending,
    getPitchReport,
    segments,
    fileHash,
    isFinished,
    micPlayersRef,
    multiplayer,
    profileData.active,
    profileData.scores,
    profilesLoading,
    queryClient,
    queuePlayback,
    scoreRef,
    skipOutroPending,
    t,
  ]);

  useEffect(() => {
    if (!showResult) {
      return undefined;
    }

    const audioElement = new Audio(successSoundUrl);
    void audioElement.play().catch(() => {});

    return () => {
      audioElement.pause();
      audioElement.src = '';
    };
  }, [showResult]);

  const onBack = useCallback(() => {
    setShowResult(false);
    handleExit();
  }, [handleExit]);
  const onNext = useCallback(
    (nextPlayers: readonly PlaybackPlayer[] = players) => playNext([...nextPlayers]),
    [playNext, players],
  );
  const hasNext = queuePlayback && entries.length > 0;

  return {
    open: showResult,
    score: results[0]?.score ?? 0,
    report: results[0]?.report ?? null,
    activeProfile: profileData.active,
    results,
    scores: profileData.scores,
    nextPending: isPreparing,
    onBack,
    onNext: hasNext ? onNext : undefined,
  };
}
