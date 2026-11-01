import { useQuery } from '@tanstack/react-query';
import { SearchIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Spinner } from '@/shared/components/ui/spinner';
import { useI18n } from '@/shared/i18n/use-i18n';
import { formatSeconds } from '@/shared/utils/format-duration';

import {
  checkImportLyrics,
  importFromYoutube,
  searchYoutube,
  thumbnailUrl,
  type ImportJob,
  type LyricsCheck,
  type YoutubeCandidate,
} from './api';
import { ErrorText } from './error-text';
import { useRemoteAction } from './use-remote';

const LYRICS_CHECK_DELAY_MS = 1000;

function isLyricsProblem(check: LyricsCheck | undefined): boolean {
  return check?.state === 'missing' || (check?.state === 'otherRelease' && check.critical);
}

function useLyricsCheck(artist: string, title: string, durationSec: number | null) {
  const [names, setNames] = useState({ artist, title });
  useEffect(() => {
    const timer = window.setTimeout(() => setNames({ artist, title }), LYRICS_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [artist, title]);

  return useQuery({
    queryKey: ['remote-lyrics-check', names.artist, names.title, durationSec],
    queryFn: () => checkImportLyrics(names.artist, names.title, durationSec),
    enabled: names.artist.trim() !== '' && names.title.trim() !== '',
    retry: false,
    staleTime: 5 * 60_000,
  });
}

function lyricsCheckMessage(
  check: LyricsCheck,
  clipSec: number | null,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (check.state) {
    case 'match':
      return t('remote.lyricsCheck.match');
    case 'missing':
      return t('remote.lyricsCheck.missing');
    case 'otherRelease':
      return t(check.critical ? 'remote.lyricsCheck.critical' : 'remote.lyricsCheck.otherRelease', {
        clip: formatSeconds(clipSec ?? 0),
        lyrics: formatSeconds(check.lyricsDurationSec),
      });
  }
  check satisfies never;
  throw new Error('Unknown lyrics check state');
}

type LyricsCheckNoticeProps = {
  check: LyricsCheck | undefined;
  checking: boolean;
  failed: boolean;
  clipSec: number | null;
};

function LyricsCheckNotice({ check, checking, failed, clipSec }: LyricsCheckNoticeProps) {
  const { t } = useI18n();
  if (checking || failed || check === undefined) {
    return (
      <output className="flex items-center gap-2 text-sm text-muted-foreground">
        {checking ? <Spinner /> : null}
        {checking ? t('remote.lyricsCheck.checking') : null}
        {!checking && failed ? t('remote.lyricsCheck.failed') : null}
      </output>
    );
  }
  const message = lyricsCheckMessage(check, clipSec, t);
  if (isLyricsProblem(check)) {
    return (
      <p className="flex gap-2 text-sm text-destructive" role="alert">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {message}
      </p>
    );
  }

  return <output className="text-sm text-muted-foreground">{message}</output>;
}

type ImportFormProps = {
  candidate: YoutubeCandidate;
  onDone: () => void;
};

function ImportForm({ candidate, onDone }: ImportFormProps) {
  const { t } = useI18n();
  const [artist, setArtist] = useState(candidate.suggestedArtist);
  const [title, setTitle] = useState(candidate.suggestedTitle);
  const lyricsCheck = useLyricsCheck(artist, title, candidate.durationSec);
  const importSong = useRemoteAction(
    () => importFromYoutube(candidate.id, artist, title),
    () => t('remote.importStarted', { title }),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    importSong.mutate(undefined, { onSuccess: onDone });
  };
  const artistId = `artist-${candidate.id}`;
  const titleId = `title-${candidate.id}`;

  return (
    <form className="flex flex-col gap-3 rounded-lg border p-3" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">{t('remote.importHint')}</p>
      <div className="flex flex-col gap-1">
        <Label htmlFor={artistId}>{t('remote.artist')}</Label>
        <Input
          id={artistId}
          required
          maxLength={200}
          className="h-11 text-base"
          value={artist}
          onChange={(event) => setArtist(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={titleId}>{t('remote.songTitle')}</Label>
        <Input
          id={titleId}
          required
          maxLength={200}
          className="h-11 text-base"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <LyricsCheckNotice
        check={lyricsCheck.data}
        checking={lyricsCheck.isFetching}
        failed={lyricsCheck.isError}
        clipSec={candidate.durationSec}
      />
      <Button
        type="submit"
        variant={isLyricsProblem(lyricsCheck.data) ? 'destructive' : 'default'}
        size="lg"
        className="h-11 text-sm"
        disabled={importSong.isLoading || artist.trim() === '' || title.trim() === ''}
      >
        {importSong.isLoading ? <Spinner /> : null}{' '}
        {isLyricsProblem(lyricsCheck.data) ? t('remote.importAnyway') : t('remote.import')}
      </Button>
    </form>
  );
}

function importStateLabel(job: ImportJob, t: ReturnType<typeof useI18n>['t']): string {
  switch (job.state) {
    case 'waiting':
      return t('remote.import.waiting');
    case 'downloading':
      return t('remote.import.downloading');
    case 'saving':
      return t('remote.import.saving');
    case 'done':
      return t('remote.import.done');
    case 'failed':
      return t('remote.import.failed', { detail: job.error });
  }
  job satisfies never;
  throw new Error('Unknown import state');
}

type YoutubePanelProps = {
  imports: ImportJob[];
};

export function YoutubePanel({ imports }: YoutubePanelProps) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const results = useQuery({
    queryKey: ['remote-youtube', query],
    queryFn: () => searchYoutube(query),
    enabled: query !== '',
    staleTime: 5 * 60_000,
  });
  const search = (event: FormEvent) => {
    event.preventDefault();
    setSelectedId(null);
    setQuery(input.trim());
  };

  return (
    <div className="flex flex-col gap-4">
      <form className="flex gap-2" onSubmit={search}>
        <Input
          type="search"
          enterKeyHint="search"
          className="h-11 text-base"
          placeholder={t('remote.searchYoutube')}
          aria-label={t('remote.searchYoutube')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <Button
          type="submit"
          size="icon-lg"
          className="size-11 shrink-0"
          disabled={input.trim() === ''}
          aria-label={t('remote.search')}
        >
          <SearchIcon />
        </Button>
      </form>

      {imports.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label={t('remote.imports')}>
          <h2 className="text-sm font-semibold">{t('remote.imports')}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {imports.map((job) => (
              <li key={job.id} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {job.artist} — {job.title}
                </span>
                <span
                  className={job.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}
                >
                  {importStateLabel(job, t)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {results.isFetching ? <Spinner className="mx-auto my-6 size-6" /> : null}
      {results.isError ? <ErrorText error={results.error} /> : null}
      {results.data?.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">{t('remote.noResults')}</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {results.data?.map((candidate) => (
          <li key={candidate.id} className="flex flex-col gap-2">
            <button
              type="button"
              className="flex items-start gap-3 rounded-lg p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${candidate.title}, ${candidate.channel}`}
              aria-expanded={selectedId === candidate.id}
              onClick={() => setSelectedId(selectedId === candidate.id ? null : candidate.id)}
            >
              <img
                src={thumbnailUrl(candidate.id)}
                alt=""
                loading="lazy"
                className="aspect-video w-32 shrink-0 rounded-md bg-muted object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-base font-medium">{candidate.title}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {candidate.channel}
                  {candidate.durationSec === null
                    ? null
                    : ` · ${formatSeconds(candidate.durationSec)}`}
                </span>
              </span>
            </button>
            {selectedId === candidate.id ? (
              <ImportForm candidate={candidate} onDone={() => setSelectedId(null)} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
