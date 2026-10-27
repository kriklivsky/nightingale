import { TrophyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import { useI18n } from '@/shared/i18n/use-i18n';
import { cn } from '@/shared/utils/cn';
import type { ScoreRecord } from '@/types/ScoreRecord';
import type { Song } from '@/types/Song';

import { MultiplayerSetupDialog } from './multiplayer-setup';
import { PitchReportLines, PitchReportOverview } from './pitch-report';
import { useResultReportNav } from './use-result-report-nav';

const TOP_LIMIT = 5;
const COUNT_UP_MS = 1200;

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

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Counts the shown score up from zero once the dialog opens. */
function useCountUp(target: number, active: boolean): number {
  const [value, setValue] = useState(0);
  const [animate] = useState(() => !prefersReducedMotion());

  useEffect(() => {
    if (!active || !animate) {
      return undefined;
    }
    const startedAt = performance.now();
    let frame = 0;
    const step = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / COUNT_UP_MS);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active, animate, target]);

  return animate ? value : target;
}

function useResultSelection(
  results: readonly PlaybackPlayerResult[],
  soloScore: number,
  soloReport: PitchReport | null,
  onNext: Props['onNext'],
) {
  const { t } = useI18n();
  const [reportIndex, setReportIndex] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const selectedResult = results.at(reportIndex);
  const score = selectedResult?.score ?? soloScore;
  const report = selectedResult?.report ?? soloReport;
  const multiplayer = results.length > 1;
  const extraActions = [];
  if (multiplayer) {
    extraActions.push({
      label: t('result.nextPlayerReport'),
      primary: false,
      onClick: () => setReportIndex((index) => (index + 1) % results.length),
    });
    if (onNext) {
      extraActions.push({
        label: t('result.changePlayers'),
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
  const { t } = useI18n();

  return (
    <div className="space-y-3">
      <Table aria-label={t('result.multiplayerResults')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('result.rank')}</TableHead>
            <TableHead>{t('result.player')}</TableHead>
            <TableHead className="text-right">{t('result.score')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((player, index) => (
            <TableRow
              key={player.id}
              className={cn(player.id === selectedResult?.id && 'bg-primary/10')}
            >
              <TableCell>{index + 1}</TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  {player.profile ?? player.id}
                  {player.personalBest && (
                    <TrophyIcon
                      className="size-4 text-amber-500"
                      aria-label={t('result.newPersonalBest')}
                    />
                  )}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{player.score}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-sm text-muted-foreground">
        {t('result.reportFor', { player: selectedResult?.profile ?? selectedResult?.id ?? '' })}
      </p>
    </div>
  );
}

type ScoreSummaryProps = {
  score: number;
  open: boolean;
  personalBest: boolean;
  board: readonly ScoreRecord[];
  activeProfile: string | null;
};

function ScoreSummary({ score, open, personalBest, board, activeProfile }: ScoreSummaryProps) {
  const { t } = useI18n();
  const shownScore = useCountUp(score, open);

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-1">
        <p
          className="text-6xl font-semibold text-primary tabular-nums"
          aria-label={t('result.scoreValue', { score })}
        >
          {shownScore}
        </p>
        <Stars score={shownScore} size="lg" className="mt-1" />
        {personalBest && (
          <output className="mt-2 flex items-center gap-2 rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-600 dark:text-amber-400">
            <TrophyIcon className="size-4" aria-hidden="true" />
            {t('result.newPersonalBest')}
          </output>
        )}
      </div>

      {board.length > 0 ? (
        <>
          <div className="h-px w-full bg-border" />
          <p className="text-center text-sm font-medium tracking-wide text-muted-foreground">
            {t('result.bestScores')}
          </p>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-10 text-sm">#</TableHead>
                <TableHead className="h-10 text-sm">{t('result.profile')}</TableHead>
                <TableHead className="h-10 text-right text-sm">{t('result.score')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.map(({ profile, score: rowScore }, i) => {
                const isCurrent = profile === activeProfile && rowScore === score;

                return (
                  <TableRow key={profile} className={cn(isCurrent && 'bg-primary/10')}>
                    <TableCell className="py-2 text-sm tabular-nums">{i + 1}</TableCell>
                    <TableCell
                      className={cn('py-2 text-sm', isCurrent && 'font-medium text-primary')}
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
  const { t } = useI18n();
  const board = topScoresForSong(scores, song.file_hash, TOP_LIMIT);
  const personalBest = selectedResult?.personalBest === true;

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
              <ScoreSummary
                score={score}
                open={open}
                personalBest={personalBest}
                board={board}
                activeProfile={activeProfile}
              />
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
          submitLabel={t('result.startNextSong')}
        />
      )}
    </Dialog>
  );
};
