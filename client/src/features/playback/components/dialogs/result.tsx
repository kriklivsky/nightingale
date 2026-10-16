import { useState } from 'react';

import type { PlaybackPlayer } from '@/bridge/playback-session';
import type { PlaybackPlayerResult } from '@/features/playback/hooks/use-playback-result';
import type { PitchReport } from '@/features/playback/lib/pitch/report';
import { topScoresForSong } from '@/features/playback/utils/result';
import { Stars } from '@/shared/components/shared/stars';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { cn } from '@/shared/utils/cn';
import type { ScoreRecord } from '@/types/ScoreRecord';
import type { Song } from '@/types/Song';

import { MultiplayerSetupDialog } from './multiplayer-setup';
import { PitchReportLines, PitchReportOverview } from './pitch-report';
import { useResultReportNav } from './use-result-report-nav';

const TOP_LIMIT = 5;

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

type Props = {
  open: boolean;
  score: number;
  results: readonly PlaybackPlayerResult[];
  report: PitchReport | null;
  guideAvailable: boolean;
  song: Song;
  scores: ScoreRecord[];
  activeProfile: string | null;
  nextPending: boolean;
  exitLabel: string;
  onBack: () => void;
  onNext?: (players?: readonly PlaybackPlayer[]) => void;
};

function useResultSelection(
  results: readonly PlaybackPlayerResult[],
  soloScore: number,
  soloReport: PitchReport | null,
  onNext: Props['onNext'],
) {
  const [reportIndex, setReportIndex] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const selectedResult = results.at(reportIndex);
  const score = selectedResult?.score ?? soloScore;
  const report = selectedResult?.report ?? soloReport;
  const multiplayer = results.length > 1;
  const extraActions = [];
  if (multiplayer) {
    extraActions.push({
      label: 'Next player report',
      primary: false,
      onClick: () => setReportIndex((index) => (index + 1) % results.length),
    });
    if (onNext) {
      extraActions.push({
        label: 'Change players',
        primary: false,
        onClick: () => setSetupOpen(true),
      });
    }
  }

  return { setupOpen, setSetupOpen, score, report, selectedResult, multiplayer, extraActions };
}

function MultiplayerResults({
  results,
  selectedResult,
}: {
  results: readonly PlaybackPlayerResult[];
  selectedResult: PlaybackPlayerResult | undefined;
}) {
  return (
    <div className="space-y-3">
      <Table aria-label="Multiplayer results">
        <TableHeader>
          <TableRow>
            <TableHead>Rank</TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="text-right">Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((player, index) => (
            <TableRow
              key={player.id}
              className={cn(player.id === selectedResult?.id && 'bg-primary/10')}
            >
              <TableCell>{index + 1}</TableCell>
              <TableCell>{player.profile ?? player.id}</TableCell>
              <TableCell className="text-right tabular-nums">{player.score}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">
        Report: {selectedResult?.profile ?? selectedResult?.id}
      </p>
    </div>
  );
}

export const ResultDialog = ({
  open,
  score: soloScore,
  report: soloReport,
  results,
  guideAvailable,
  song,
  scores,
  activeProfile,
  nextPending,
  exitLabel,
  onBack,
  onNext,
}: Props) => {
  const { setupOpen, setSetupOpen, score, report, selectedResult, multiplayer, extraActions } =
    useResultSelection(results, soloScore, soloReport, onNext);
  const board = topScoresForSong(scores, song.file_hash, TOP_LIMIT);

  const { focusedIndex, page, pages, actions, containerRef } = useResultReportNav({
    open: open && !setupOpen,
    phraseCount: report?.phrases.length ?? 0,
    nextPending,
    exitLabel,
    onBack,
    onNext,
    extraActions,
  });

  return (
    <Dialog open={open} modal>
      <DialogContent
        ref={containerRef}
        showCloseButton={false}
        className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-5xl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-6 p-7 sm:p-8">
          <DialogHeader className="gap-2 text-center sm:text-center">
            <DialogTitle className="text-2xl font-semibold sm:text-3xl">{song.title}</DialogTitle>
            <DialogDescription className="text-base">{song.artist}</DialogDescription>
          </DialogHeader>

          {multiplayer && <MultiplayerResults results={results} selectedResult={selectedResult} />}

          {page !== null && report ? (
            <PitchReportLines report={report} page={page} pages={pages} />
          ) : (
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-1">
                  <p
                    className="text-6xl font-semibold text-primary tabular-nums"
                    aria-label={`Score ${score}`}
                  >
                    {score}
                  </p>
                  <Stars score={score} size="lg" className="mt-1" />
                </div>

                {board.length > 0 ? (
                  <>
                    <div className="h-px w-full bg-border" />
                    <p className="text-center text-sm font-medium tracking-wide text-muted-foreground">
                      BEST SCORES
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-10 text-sm">#</TableHead>
                          <TableHead className="h-10 text-sm">Profile</TableHead>
                          <TableHead className="h-10 text-right text-sm">Score</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {board.map(({ profile, score: rowScore }, i) => {
                          const isCurrent = profile === activeProfile && rowScore === score;

                          return (
                            <TableRow key={profile} className={cn(isCurrent && 'bg-primary/10')}>
                              <TableCell className="py-2 text-sm tabular-nums">{i + 1}</TableCell>
                              <TableCell
                                className={cn(
                                  'py-2 text-sm',
                                  isCurrent && 'font-medium text-primary',
                                )}
                              >
                                {profile}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  'py-2 text-right text-sm tabular-nums',
                                  isCurrent && 'font-medium text-primary',
                                )}
                              >
                                {rowScore}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <PitchReportOverview report={report} guideAvailable={guideAvailable} />
              </div>
            </div>
          )}

          <DialogFooter className="mt-2 flex-col sm:justify-center">
            {actions.map(({ label, primary, onClick }, index) => (
              <Button
                key={label}
                type="button"
                variant={primary ? 'default' : 'outline'}
                className={cn(
                  'min-h-12 w-full text-base sm:w-auto sm:min-w-40',
                  NO_FOCUS_RING,
                  open && focusedIndex === index && RING,
                )}
                disabled={nextPending}
                onClick={onClick}
              >
                {label}
              </Button>
            ))}
          </DialogFooter>
        </div>
      </DialogContent>
      {onNext && (
        <MultiplayerSetupDialog
          open={setupOpen}
          onOpenChange={setSetupOpen}
          onStart={onNext}
          queuePlayback
          submitLabel="Start next song"
        />
      )}
    </Dialog>
  );
};
