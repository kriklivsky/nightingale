import type { ReactNode } from 'react';

import { Stars } from '@/shared/components/shared/stars';
import type { MessageKey } from '@/shared/i18n/translator';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';
import type { SongSortColumn } from '@/types/SongSortColumn';

import { AlbumArt } from '../song/album-art';
import { LanguageBadge } from '../song/language-badge';
import { StatusBadge } from '../song/status-badge';
import { YoutubeVideoBadge } from '../song/youtube-video-badge';

export type SongColumn = {
  id: string;
  headerKey: MessageKey;
  headerHidden?: boolean;
  sortColumn?: SongSortColumn;
  thClassName: string;
  tdClassName: string;
  cell: (
    song: Song,
    queueStatus?: QueuedStatus,
    bestScore?: number,
    hasYoutubeVideo?: boolean,
  ) => ReactNode;
};

export const SONG_COLUMNS: SongColumn[] = [
  {
    id: 'thumbnail',
    headerKey: 'library.column.cover',
    headerHidden: true,
    thClassName: 'song-table-thumbnail px-2 py-2 font-medium',
    tdClassName: 'song-table-thumbnail py-1.5 pr-2 pl-2',
    cell: (song) => (
      <AlbumArt
        song={song}
        className="size-10 rounded-md"
        fallbackIconClassName="size-5"
        showVideoBadge
      />
    ),
  },
  {
    id: 'song',
    headerKey: 'library.column.song',
    sortColumn: 'title',
    thClassName: 'song-table-song px-2 py-2 font-medium',
    tdClassName: 'song-table-song px-2 py-2 align-middle font-medium',
    cell: (song, _queueStatus, bestScore, hasYoutubeVideo) => (
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 line-clamp-2 break-words leading-5" title={song.title}>
            {song.title}
          </span>
          <LanguageBadge language={song.language} />
        </div>
        <span className="song-table-inline-artist truncate text-xs font-normal text-muted-foreground">
          {song.artist}
        </span>
        {hasYoutubeVideo === true && (
          <div className="mt-1">
            <YoutubeVideoBadge />
          </div>
        )}
        {bestScore === undefined ? null : <Stars score={bestScore} size="sm" className="mt-0.5" />}
      </div>
    ),
  },
  {
    id: 'band',
    headerKey: 'library.column.artist',
    sortColumn: 'artist',
    thClassName: 'song-table-band px-2 py-2 font-medium',
    tdClassName: 'song-table-band px-2 py-2 text-muted-foreground',
    cell: (song) => <span className="block truncate">{song.artist || '—'}</span>,
  },
  {
    id: 'album',
    headerKey: 'library.column.album',
    sortColumn: 'album',
    thClassName: 'song-table-album px-2 py-2 font-medium',
    tdClassName: 'song-table-album px-2 py-2 text-muted-foreground',
    cell: (song) => <span className="block truncate">{song.album || '—'}</span>,
  },
  {
    id: 'duration',
    headerKey: 'library.column.duration',
    sortColumn: 'duration',
    thClassName: 'song-table-duration px-2 py-2 font-medium',
    tdClassName:
      'song-table-duration px-2 py-2 font-variant-numeric tabular-nums text-muted-foreground',
    cell: (song) => formatSeconds(song.duration_secs),
  },
  {
    id: 'status',
    headerKey: 'library.column.status',
    sortColumn: 'status',
    thClassName: 'song-table-status px-2 py-2 text-right font-medium',
    tdClassName: 'song-table-status px-2 py-2 text-right',
    cell: (song, queueStatus) => <StatusBadge song={song} queueStatus={queueStatus} />,
  },
];
