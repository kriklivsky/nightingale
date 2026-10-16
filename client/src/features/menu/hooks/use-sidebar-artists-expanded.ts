import { atom, useAtom } from 'jotai';

const sidebarArtistsExpandedAtom = atom<ReadonlySet<string>>(new Set<string>());

export function useSidebarArtistsExpanded() {
  return useAtom(sidebarArtistsExpandedAtom);
}
