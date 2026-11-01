import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, ChevronRightIcon, PlayIcon, PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Spinner } from '@/shared/components/ui/spinner';
import { useI18n } from '@/shared/i18n/use-i18n';
import { formatSeconds } from '@/shared/utils/format-duration';

import {
  addToQueue,
  loadArtistSongs,
  loadArtists,
  searchSongs,
  type RemoteArtist,
  type RemoteSong,
} from './api';
import { ErrorText } from './error-text';
import { failureDetail, useRemoteAction, useSongStatusLabel } from './use-remote';

const SEARCH_DELAY_MS = 300;

type StartSong = (fileHash: string, title: string) => void;

type SongListProps = {
  songs: readonly RemoteSong[];
  canStart: boolean;
  onStart: StartSong;
};

function SongList({ songs, canStart, onStart }: SongListProps) {
  const { t } = useI18n();
  const statusLabel = useSongStatusLabel();
  const add = useRemoteAction(
    ({ fileHash }: { fileHash: string; title: string }) => addToQueue(fileHash),
    ({ title }) => t('queue.added', { title }),
  );

  if (songs.length === 0) {
    return <p className="py-6 text-center text-muted-foreground">{t('remote.noResults')}</p>;
  }

  return (
    <ul className="divide-y">
      {songs.map((song) => {
        const status = statusLabel(song);
        return (
          <li key={song.fileHash} className="flex items-center gap-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium">{song.title}</p>
              <p className="truncate text-sm text-muted-foreground">
                {song.artist || '—'} · {formatSeconds(song.durationSec)}
                {status === null ? null : <span className="text-primary">{` · ${status}`}</span>}
              </p>
              {failureDetail(song) === null ? null : (
                <p className="line-clamp-2 text-xs text-destructive">{failureDetail(song)}</p>
              )}
            </div>
            {canStart ? (
              <Button
                variant="outline"
                size="icon-lg"
                className="size-11"
                disabled={song.status !== 'ready'}
                onClick={() => onStart(song.fileHash, song.title)}
                aria-label={t('remote.playNow', { title: song.title })}
              >
                <PlayIcon />
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="icon-lg"
              className="size-11"
              disabled={song.status !== 'ready' || add.isLoading}
              onClick={() => add.mutate({ fileHash: song.fileHash, title: song.title })}
              aria-label={t('remote.add', { title: song.title })}
            >
              <PlusIcon />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

type ArtistSongsProps = {
  artist: RemoteArtist;
  canStart: boolean;
  onStart: StartSong;
};

function ArtistSongs({ artist, canStart, onStart }: ArtistSongsProps) {
  const songs = useQuery({
    queryKey: ['remote-artist-songs', artist.value],
    queryFn: () => loadArtistSongs(artist.value),
  });

  if (songs.isError) {
    return <ErrorText error={songs.error} />;
  }
  if (songs.data === undefined) {
    return <Spinner className="mx-auto my-4 size-5" />;
  }
  return <SongList songs={songs.data} canStart={canStart} onStart={onStart} />;
}

type ArtistListProps = {
  canStart: boolean;
  onStart: StartSong;
};

function ArtistList({ canStart, onStart }: ArtistListProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const artists = useQuery({
    queryKey: ['remote-artists'],
    queryFn: loadArtists,
    staleTime: 60_000,
  });

  if (artists.isError) {
    return <ErrorText error={artists.error} />;
  }
  if (artists.data === undefined) {
    return <Spinner className="mx-auto my-6 size-6" />;
  }

  return (
    <ul className="divide-y">
      {artists.data.map((artist) => {
        const expanded = open === artist.value;
        return (
          <li key={artist.value}>
            <button
              type="button"
              className="flex min-h-12 w-full items-center gap-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : artist.value)}
            >
              {expanded ? (
                <ChevronDownIcon className="size-4 shrink-0" />
              ) : (
                <ChevronRightIcon className="size-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate text-base font-medium">{artist.label}</span>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                {t('remote.artistSongs', { ready: artist.readyCount, count: artist.count })}
              </span>
            </button>
            {expanded ? (
              <div className="pb-2 pl-6">
                <ArtistSongs artist={artist} canStart={canStart} onStart={onStart} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

type LibraryPanelProps = {
  canStart: boolean;
  onStart: StartSong;
};

export function LibraryPanel({ canStart, onStart }: LibraryPanelProps) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const songs = useQuery({
    queryKey: ['remote-songs', query],
    queryFn: () => searchSongs(query),
    enabled: query !== '',
    keepPreviousData: true,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        enterKeyHint="search"
        className="h-11 text-base"
        placeholder={t('remote.searchLibrary')}
        aria-label={t('remote.searchLibrary')}
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      {query === '' ? <ArtistList canStart={canStart} onStart={onStart} /> : null}
      {query !== '' && songs.isError ? <ErrorText error={songs.error} /> : null}
      {query !== '' && songs.data !== undefined ? (
        <SongList songs={songs.data} canStart={canStart} onStart={onStart} />
      ) : null}
      {query !== '' && songs.isFetching && songs.data === undefined ? (
        <Spinner className="mx-auto my-6 size-6" />
      ) : null}
    </div>
  );
}
