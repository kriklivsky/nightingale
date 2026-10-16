import { EmptyLibrary } from './components/empty-library';
import { Library } from './components/library';
import { useSongsMeta } from './queries/use-songs';

export const LibraryPage = () => {
  const { data: meta, isLoading } = useSongsMeta();

  if (isLoading) {
    return null;
  }

  return typeof meta?.folder === 'string' && meta.folder !== '' ? <Library /> : <EmptyLibrary />;
};
