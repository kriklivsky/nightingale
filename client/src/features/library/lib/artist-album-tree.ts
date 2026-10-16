import type { LibraryMenuItem } from '@/types/LibraryMenuItem';

const ALBUM_VALUE_SEPARATOR = '\u001f';

const albumArtist = (album: LibraryMenuItem): string | null => {
  const separator = album.value.indexOf(ALBUM_VALUE_SEPARATOR);
  return separator < 0 ? null : album.value.slice(0, separator);
};

export function artistParents(albums: readonly LibraryMenuItem[]): ReadonlySet<string> {
  return new Set(albums.map(albumArtist).filter((artist): artist is string => artist !== null));
}

export function visibleArtistAlbums(
  artists: readonly LibraryMenuItem[],
  albums: readonly LibraryMenuItem[],
  expanded: ReadonlySet<string>,
): LibraryMenuItem[] {
  const albumsByArtist = new Map<string, LibraryMenuItem[]>();
  albums.forEach((album) => {
    const artist = albumArtist(album);
    if (artist === null) {
      return;
    }
    const separator = album.value.indexOf(ALBUM_VALUE_SEPARATOR);
    const item = { ...album, label: album.value.slice(separator + 1), depth: 1 };
    const artistAlbums = albumsByArtist.get(artist) ?? [];
    artistAlbums.push(item);
    albumsByArtist.set(artist, artistAlbums);
  });

  return artists.flatMap((artist) => [
    artist,
    ...(expanded.has(artist.value) ? (albumsByArtist.get(artist.value) ?? []) : []),
  ]);
}
