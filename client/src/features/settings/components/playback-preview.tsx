import type { CSSProperties } from 'react';

import { useI18n } from '@/shared/i18n/use-i18n';

type PlaybackPreviewProps = {
  lyricsVerticalPosition: string;
  lyricsHorizontalPosition: string;
  lyricsScale: number;
  pitchGraphScale: number;
  pitchDisplay: string;
};

const gridBackground: CSSProperties = {
  containerType: 'size',
  backgroundColor: '#070b14',
  backgroundImage:
    'radial-gradient(circle at 50% 35%, rgb(37 99 235 / 0.2), transparent 45%), linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)',
  backgroundSize: 'auto, 5% 8.89%, 5% 8.89%',
};

function horizontalClass(position: string): string {
  if (position === 'left') {
    return 'items-start text-left';
  }
  if (position === 'right') {
    return 'items-end text-right';
  }
  return 'items-center text-center';
}

function verticalClass(position: string): string {
  if (position === 'top') {
    return 'top-[5.5%] justify-start';
  }
  if (position === 'center') {
    return 'inset-y-0 justify-center';
  }
  return 'bottom-[5.5%] justify-end';
}

const PREVIEW_NOTES = [
  { left: 4, width: 14, row: 3 },
  { left: 21, width: 9, row: 2 },
  { left: 33, width: 16, row: 4 },
  { left: 52, width: 11, row: 1 },
  { left: 66, width: 18, row: 3 },
  { left: 87, width: 9, row: 2 },
];

function PreviewPitchLane() {
  return (
    <div className="relative h-[7cqh]">
      {PREVIEW_NOTES.map((note) => (
        <span
          key={note.left}
          className="absolute h-[0.9cqh] rounded-full bg-white/30"
          style={{ left: `${note.left}%`, width: `${note.width}%`, top: `${note.row * 1.4}cqh` }}
        />
      ))}
      <span className="absolute inset-y-0 left-[33%] w-[0.2cqh] bg-white/80" />
    </div>
  );
}

function PreviewPitchMeter({ label }: { label: string }) {
  const { t } = useI18n();

  return (
    <>
      <p className="text-center text-white/70" style={{ fontSize: '1.1cqh' }}>
        {label}
      </p>
      <div className="relative mt-[1.1cqh] h-[0.75cqh] rounded-full bg-white/15">
        <span className="absolute inset-y-0 left-5/12 w-1/6 bg-white/35" />
        <span className="absolute -inset-y-[0.2cqh] left-1/2 w-[0.2cqh] bg-white" />
      </div>
      <div
        className="mt-[0.75cqh] flex justify-between text-white/70"
        style={{ fontSize: '1.1cqh' }}
      >
        <span>{t('playback.pitchLow')}</span>
        <span>{t('playback.pitchTarget')}</span>
        <span>{t('playback.pitchHigh')}</span>
      </div>
    </>
  );
}

export function PlaybackPreview({
  lyricsVerticalPosition,
  lyricsHorizontalPosition,
  lyricsScale,
  pitchGraphScale,
  pitchDisplay,
}: PlaybackPreviewProps) {
  const { t } = useI18n();
  const hudPosition = lyricsVerticalPosition === 'top' ? 'bottom' : 'top';
  const lane = pitchDisplay !== 'meter';

  return (
    <figure
      aria-label={t('settings.preview')}
      className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 shadow-xl shadow-black/20"
      style={gridBackground}
    >
      <div
        className={`absolute inset-x-[1.5%] z-20 flex flex-col gap-[0.8cqh] text-white ${
          hudPosition === 'bottom' ? 'bottom-[1.5%] flex-col-reverse' : 'top-[1.5%]'
        }`}
      >
        <div
          className={`flex justify-between ${hudPosition === 'bottom' ? 'items-end' : 'items-start'}`}
        >
          <div className={hudPosition === 'bottom' ? 'flex flex-col-reverse' : undefined}>
            <p className="leading-tight font-medium" style={{ fontSize: '2cqh' }}>
              Nightingale
            </p>
            <p className="text-white/65" style={{ fontSize: '1.45cqh' }}>
              {t('settings.previewArtist')}
            </p>
            <p className="text-white/65" style={{ fontSize: '1.45cqh' }}>
              1:24 / 3:42
            </p>
          </div>
          <p className="text-white/80" style={{ fontSize: '2cqh' }}>
            {t('playback.score', { score: 842 })}
          </p>
        </div>
        <div className="relative h-[0.6cqh] overflow-hidden rounded-full bg-white/15">
          <span className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-primary" />
        </div>
      </div>

      <div
        className={`absolute left-1/2 z-20 -translate-x-1/2 rounded-[0.7cqh] border border-white/20 bg-black/60 p-[0.75cqh] ${
          lane ? 'w-[45%]' : 'w-[18.75%]'
        } ${hudPosition === 'bottom' ? 'bottom-[12%]' : 'top-[12%]'}`}
        style={{
          scale: String(pitchGraphScale),
          transformOrigin: hudPosition === 'bottom' ? 'center bottom' : 'center top',
        }}
      >
        {lane ? <PreviewPitchLane /> : <PreviewPitchMeter label={t('playback.pitchMeterLabel')} />}
      </div>

      <div
        className={`pointer-events-none absolute inset-x-[3%] z-10 flex flex-col gap-[0.8cqh] ${verticalClass(lyricsVerticalPosition)} ${horizontalClass(lyricsHorizontalPosition)}`}
      >
        <div
          className="max-w-[78%] rounded-[0.7cqh] bg-black/45 px-[1.1cqh] py-[0.7cqh] leading-tight font-bold text-white shadow-lg"
          style={{ fontSize: `${3.7037 * lyricsScale}cqh` }}
        >
          <span className="text-[rgb(103,232,249)]">{t('settings.previewSungLine')}</span>{' '}
          {t('settings.previewUnsungLine')}
        </div>
        <div
          className="max-w-[78%] rounded-[0.5cqh] bg-black/30 px-[0.9cqh] py-[0.5cqh] leading-tight text-white/40"
          style={{ fontSize: `${2.2222 * lyricsScale}cqh` }}
        >
          {t('settings.previewNextLine')}
        </div>
      </div>
    </figure>
  );
}
