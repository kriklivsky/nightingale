import { XIcon } from 'lucide-react';

import { Stars } from '@/shared/components/shared/stars';
import { Button } from '@/shared/components/ui/button';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

import { AlbumArt } from '../song/album-art';
import { LanguageBadge, isDisplayableLanguage } from '../song/language-badge';
import { StatusBadge } from '../song/status-badge';

type SongDetailsHeaderProps = {
  song: Song;
  queueStatus?: QueuedStatus;
  bestScore?: number;
  onClose: () => void;
};

export const SongDetailsHeader = ({
  song,
  queueStatus,
  bestScore,
  onClose,
}: SongDetailsHeaderProps) => (
  <header className="relative border-b px-4 pb-4 pt-3">
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-2 top-2"
      onClick={onClose}
      aria-label="Close song details"
    >
      <XIcon />
    </Button>

    <div className="flex items-center gap-4 pr-10">
      <AlbumArt
        song={song}
        className="size-20 rounded-lg"
        fallbackIconClassName="size-8"
        lazy={false}
      />

      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-balance">
          {song.title}
        </h2>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {song.artist || 'Unknown band'}
        </p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {song.album || 'Unknown album'}
        </p>
        {bestScore === undefined ? null : <Stars score={bestScore} size="sm" className="mt-1" />}
      </div>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <StatusBadge song={song} queueStatus={queueStatus} />
      {isDisplayableLanguage(song.language) ? (
        <>
          <span aria-hidden="true">·</span>
          <LanguageBadge language={song.language} />
        </>
      ) : null}
      <span aria-hidden="true">·</span>
      <span className="tabular-nums">{formatSeconds(song.duration_secs)}</span>
    </div>
  </header>
);
