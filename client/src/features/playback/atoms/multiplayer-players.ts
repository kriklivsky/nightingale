import { atom } from 'jotai';

import { getPreloadedConfig } from '@/bridge/config';
import type { PlaybackPlayer } from '@/bridge/playback-session';
import { playbackPlayersSchema } from '@/bridge/schemas';

function startupPlayers(): PlaybackPlayer[] | null {
  const players = getPreloadedConfig()?.multiplayer_players;
  const parsed = playbackPlayersSchema.safeParse(players);
  return parsed.success ? parsed.data : null;
}

export const multiplayerPlayersAtom = atom<PlaybackPlayer[] | null>(startupPlayers());
