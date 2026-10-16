import { useSongWindow } from '@/features/library/hooks/use-song-window';
import { useBestScoresBySongForActiveProfile } from '@/features/profiles/hooks/use-best-scores-by-song';
import type { Song } from '@/types/Song';

import { songKey } from '../../song/song-key';
import type { SongItemProps } from '../types';
import { SongGridCard } from './song-grid-card';

type SongGridProps = {
  songs: Song[];
  getItemProps: (song: Song, index: number) => SongItemProps;
};

export const SongGrid = ({ songs, getItemProps }: SongGridProps) => {
  const bestScores = useBestScoresBySongForActiveProfile();
  const window = useSongWindow(songs, 'grid');

  return (
    <ul className="p-1">
      <li aria-hidden="true" style={{ height: window.before }} />
      {window.rows.map((row) => (
        <li key={row.key} ref={window.measure} data-index={row.index} className="pb-3">
          <ul
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${window.columns}, minmax(0, 1fr))` }}
          >
            {songs
              .slice(row.index * window.columns, (row.index + 1) * window.columns)
              .map((song, column) => (
                <li
                  key={songKey(song)}
                  aria-posinset={row.index * window.columns + column + 1}
                  aria-setsize={songs.length}
                >
                  <SongGridCard
                    {...getItemProps(song, row.index * window.columns + column)}
                    bestScore={bestScores.get(song.file_hash)}
                  />
                </li>
              ))}
          </ul>
        </li>
      ))}
      <li aria-hidden="true" style={{ height: window.after }} />
    </ul>
  );
};
