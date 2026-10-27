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
import type { Translate } from '@/shared/i18n/translator';
import { useI18n } from '@/shared/i18n/use-i18n';

import { REPORT_PAGE_SIZE } from './use-result-report-nav';

function percent(count: number, total: number): string {
  return total === 0 ? '—' : `${Math.round((count / total) * 100)}%`;
}

function averageError(t: Translate, totals: PitchTotals): string {
  return totals.voiced === 0
    ? '—'
    : t('report.semitones', { value: (totals.absoluteDeviation / totals.voiced).toFixed(1) });
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
  const { t } = useI18n();
  if (!report || report.totals.reference === 0) {
    return <p className="rounded-xl border p-5 text-muted-foreground">{t('report.noReference')}</p>;
  }
  const totals = report.totals;
  if (totals.voiced === 0) {
    return <p className="rounded-xl border p-5 text-muted-foreground">{t('report.noVoice')}</p>;
  }

  const distribution = [
    { label: t('report.onPitch'), count: totals.onPitch, color: 'bg-emerald-500' },
    { label: t('report.below'), count: totals.low, color: 'bg-blue-500' },
    { label: t('report.above'), count: totals.high, color: 'bg-amber-500' },
    {
      label: t('report.noVoicePitch'),
      count: totals.reference - totals.voiced,
      color: 'bg-muted-foreground/40',
    },
  ];

  return (
    <section aria-label={t('report.title')} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label={t('report.onPitch')}
          value={percent(totals.onPitch, totals.voiced)}
          description={t('report.onPitchDescription', { tolerance: ON_PITCH_SEMITONES })}
        />
        <Metric
          label={t('report.voiceDetected')}
          value={percent(totals.voiced, totals.reference)}
          description={t('report.acrossReference')}
        />
        <Metric
          label={t('report.averageError')}
          value={averageError(t, totals)}
          description={t('report.averageErrorDescription')}
        />
        <Metric
          label={t('report.belowAbove')}
          value={`${percent(totals.low, totals.voiced)} / ${percent(totals.high, totals.voiced)}`}
          description={t('report.belowAboveDescription')}
        />
      </div>
      <div>
        <p className="mb-2 text-sm text-muted-foreground">{t('report.acrossReference')}</p>
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
        {t('report.scopeNote')} {!guideAvailable && t('report.approximateNote')}
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
  const { t } = useI18n();
  const phrases = report.phrases.slice(page * REPORT_PAGE_SIZE, (page + 1) * REPORT_PAGE_SIZE);

  return (
    <section aria-label={t('report.lineTitle')} className="space-y-3">
      <div className="flex justify-between gap-3 text-sm text-muted-foreground">
        <p>{t('report.lineSummary', { tolerance: ON_PITCH_SEMITONES })}</p>
        <p className="shrink-0">{t('report.page', { page: page + 1, pages })}</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('report.lyricsTime')}</TableHead>
            <TableHead>{t('report.onPitch')}</TableHead>
            <TableHead>{t('report.voiceDetected')}</TableHead>
            <TableHead>{t('report.averageErrorShort')}</TableHead>
            <TableHead>{t('report.belowAboveShort')}</TableHead>
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
              <TableCell className="tabular-nums">{averageError(t, totals)}</TableCell>
              <TableCell className="tabular-nums">
                {percent(totals.low, totals.voiced)} / {percent(totals.high, totals.voiced)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t('report.lineFootnote')}</p>
    </section>
  );
}
