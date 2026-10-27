import { EmptyLibrary } from './components/empty-library';
import { Library } from './components/library';
import { LibrarySkeleton } from './components/library-skeleton';
import { useSongsMeta } from './queries/use-songs';

export const LibraryPage = () => {
  const { data: meta, isLoading } = useSongsMeta();

  if (isLoading) {
    return <LibrarySkeleton />;
  }

  return typeof meta?.folder === 'string' && meta.folder !== '' ? <Library /> : <EmptyLibrary />;
};
