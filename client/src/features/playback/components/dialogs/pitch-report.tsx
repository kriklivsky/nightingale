import type { PitchReport, PitchTotals } from '@/features/playback/lib/pitch/report';
import { ON_PITCH_SEMITONES } from '@/features/playback/lib/pitch/report';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';

import { REPORT_PAGE_SIZE } from './use-result-report-nav';

function percent(count: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((count / total) * 100)}%`;
}

function averageError(totals: PitchTotals): string {
  return totals.voiced === 0
    ? '—'
    : `${(totals.absoluteDeviation / totals.voiced).toFixed(1)} semitones`;
}

function timeLabel(timeSec: number): string {
  const seconds = Math.floor(timeSec);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function Metric({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/40 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export function PitchReportOverview({
  report,
  guideAvailable,
}: {
  report: PitchReport | null;
  guideAvailable: boolean;
}) {
  if (!report || report.totals.reference === 0) {
    return (
      <p className="rounded-xl border p-5 text-muted-foreground">
        No reference notes were detected. A pitch report is unavailable for this performance.
      </p>
    );
  }
  const totals = report.totals;
  if (totals.voiced === 0) {
    return (
      <p className="rounded-xl border p-5 text-muted-foreground">
        No comparable voice pitch was detected. Check the microphone input; this is not a vocal
        quality rating.
      </p>
    );
  }

  const distribution = [
    { label: 'On pitch', count: totals.onPitch, color: 'bg-emerald-500' },
    { label: 'Below', count: totals.low, color: 'bg-blue-500' },
    { label: 'Above', count: totals.high, color: 'bg-amber-500' },
    {
      label: 'No voice pitch',
      count: totals.reference - totals.voiced,
      color: 'bg-muted-foreground/40',
    },
  ];

  return (
    <section aria-label="Pitch report" className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="On pitch"
          value={percent(totals.onPitch, totals.voiced)}
          description={`Detected voice within ±${ON_PITCH_SEMITONES} semitones`}
        />
        <Metric
          label="Voice detected"
          value={percent(totals.voiced, totals.reference)}
          description="Across sampled reference notes"
        />
        <Metric
          label="Average pitch error"
          value={averageError(totals)}
          description="Detected voice only; octaves treated equally"
        />
        <Metric
          label="Below / above melody"
          value={`${percent(totals.low, totals.voiced)} / ${percent(totals.high, totals.voiced)}`}
          description="Detected voice outside the target range"
        />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Across sampled reference notes</p>
        <div className="flex h-3 overflow-hidden rounded-full" aria-hidden="true">
          {distribution.map(({ label, count, color }) => (
            <span
              key={label}
              className={color}
              style={{ width: `${(count / totals.reference) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {distribution.map(({ label, count, color }) => (
            <p key={label} className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${color}`} />
              {label}: {percent(count, totals.reference)}
            </p>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Pitch measurements for this performance only, not vocal technique or rhythm. Only sampled
        sections are included.{' '}
        {!guideAvailable &&
          'Approximate: reference comes from the original mix, not isolated vocals.'}
      </p>
    </section>
  );
}

export function PitchReportLines({
  report,
  page,
  pages,
}: {
  report: PitchReport;
  page: number;
  pages: number;
}) {
  const phrases = report.phrases.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE);

  return (
    <section aria-label="Line-by-line pitch report" className="space-y-3">
      <div className="flex justify-between gap-3 text-sm text-muted-foreground">
        <p>Detected voice within ±{ON_PITCH_SEMITONES} semitones · Octaves treated equally</p>
        <p className="shrink-0">
          Page {page + 1} / {pages}
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lyrics / time</TableHead>
            <TableHead>On pitch</TableHead>
            <TableHead>Voice detected</TableHead>
            <TableHead>Average error</TableHead>
            <TableHead>Below / above</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {phrases.map(({ start, end, text, totals }, index) => (
            <TableRow key={`${start}-${page * REPORT_PAGE_SIZE + index}`}>
              <TableCell className="max-w-72 whitespace-normal">
                <p className="line-clamp-2 font-medium">{text}</p>
                <p className="text-xs text-muted-foreground">
                  {timeLabel(start)}–{timeLabel(end)}
                </p>
              </TableCell>
              <TableCell className="tabular-nums">
                {percent(totals.onPitch, totals.voiced)}
              </TableCell>
              <TableCell className="tabular-nums">
                {percent(totals.voiced, totals.reference)}
              </TableCell>
              <TableCell className="tabular-nums">{averageError(totals)}</TableCell>
              <TableCell className="tabular-nums">
                {percent(totals.low, totals.voiced)} / {percent(totals.high, totals.voiced)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        No voice pitch can also mean quiet, unvoiced sounds or a microphone interruption. “—” means
        there is no data to compare, not a failed note.
      </p>
    </section>
  );
}
