import { z } from 'zod';

import type { RemoteCommand } from '@/bridge/remote-control';
import { playbackPlayerSchema } from '@/bridge/schemas';

const fileHashSchema = z.string().regex(/^[A-Fa-f0-9]{32}$/);
const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

const songSchema = z.object({
  fileHash: fileHashSchema,
  title: z.string(),
  artist: z.string(),
  durationSec: z.number(),
  status: z.enum(['ready', 'queued', 'analyzing', 'failed', 'notAnalyzed']),
  progress: z.number().nullable(),
  error: z.string().nullable(),
});

const importBase = z.object({
  id: z.string(),
  videoId: videoIdSchema,
  artist: z.string(),
  title: z.string(),
});

const importSchema = z.discriminatedUnion('state', [
  importBase.extend({ state: z.literal('waiting') }),
  importBase.extend({ state: z.literal('downloading') }),
  importBase.extend({ state: z.literal('saving') }),
  importBase.extend({ state: z.literal('done'), fileHash: fileHashSchema }),
  importBase.extend({ state: z.literal('failed'), error: z.string() }),
]);

const tvSchema = z.discriminatedUnion('screen', [
  z.object({ screen: z.literal('menu') }),
  z.object({
    screen: z.literal('playback'),
    fileHash: fileHashSchema,
    title: z.string(),
    artist: z.string(),
    ready: z.boolean(),
    paused: z.boolean(),
    resultOpen: z.boolean(),
    positionSec: z.number(),
    durationSec: z.number(),
    outputVolume: z.number(),
    guideVolume: z.number(),
    guideAvailable: z.boolean(),
    micEnabled: z.boolean(),
    monitorEnabled: z.boolean(),
    multiplayer: z.boolean(),
    canSkip: z.boolean(),
  }),
]);

const stateSchema = z.object({
  queue: z.array(z.object({ id: z.string(), song: songSchema })),
  imports: z.array(importSchema),
  tv: tvSchema.nullable(),
  monitorGain: z.number(),
});

const microphoneSchema = z.object({ id: z.string().min(1), label: z.string() });

const setupSchema = z.object({
  profiles: z.array(z.string()),
  activeProfile: z.string().nullable(),
  preferredMicrophone: z.string().nullable(),
  soloMicrophones: z.array(microphoneSchema),
  multiplayerMicrophones: z.array(microphoneSchema),
  rememberedPlayers: z.array(playbackPlayerSchema).nullable(),
});

const candidateSchema = z.object({
  id: videoIdSchema,
  title: z.string(),
  channel: z.string(),
  durationSec: z.number().nullable(),
  suggestedArtist: z.string(),
  suggestedTitle: z.string(),
});

const lyricsCheckSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('match') }),
  z.object({
    state: z.literal('otherRelease'),
    lyricsDurationSec: z.number(),
    critical: z.boolean(),
  }),
  z.object({ state: z.literal('missing') }),
]);

const artistSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number(),
  readyCount: z.number(),
});

const errorSchema = z.object({ error: z.string() });

export type RemoteSong = z.infer<typeof songSchema>;
export type RemoteArtist = z.infer<typeof artistSchema>;
export type RemoteState = z.infer<typeof stateSchema>;
export type ImportJob = z.infer<typeof importSchema>;
export type YoutubeCandidate = z.infer<typeof candidateSchema>;
export type LyricsCheck = z.infer<typeof lyricsCheckSchema>;
export type TvStatus = z.infer<typeof tvSchema>;
export type PlayingStatus = Extract<TvStatus, { screen: 'playback' }>;
export type StartSetup = z.infer<typeof setupSchema>;
export type RemoteMicrophone = z.infer<typeof microphoneSchema>;

export class RemoteRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const isSignedOut = (error: unknown): boolean =>
  error instanceof RemoteRequestError && error.status === 401;

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, cache: 'no-store', credentials: 'same-origin' });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body);
    throw new RemoteRequestError(
      parsed.success ? parsed.data.error : `${response.status} ${response.statusText}`,
      response.status,
    );
  }
  return body;
}

const postJson = async (path: string, body: object): Promise<unknown> =>
  await request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const post = async (path: string, body: object = {}): Promise<RemoteState> =>
  stateSchema.parse(await postJson(path, body));

export const loadState = async (): Promise<RemoteState> =>
  stateSchema.parse(await request('/api/state'));

export const searchSongs = async (query: string): Promise<RemoteSong[]> =>
  z.array(songSchema).parse(await request(`/api/songs?q=${encodeURIComponent(query)}`));

export const loadArtistSongs = async (artist: string): Promise<RemoteSong[]> =>
  z.array(songSchema).parse(await request(`/api/songs?artist=${encodeURIComponent(artist)}`));

export const loadArtists = async (): Promise<RemoteArtist[]> =>
  z.array(artistSchema).parse(await request('/api/artists'));

export const signIn = async (username: string, password: string): Promise<void> => {
  await postJson('/api/login', { username, password });
};

export const signOut = async (): Promise<void> => {
  await postJson('/api/logout', {});
};

export const searchYoutube = async (query: string): Promise<YoutubeCandidate[]> =>
  z.array(candidateSchema).parse(await request(`/api/youtube?q=${encodeURIComponent(query)}`));

export const checkImportLyrics = async (
  artist: string,
  title: string,
  durationSec: number | null,
): Promise<LyricsCheck> => {
  const parameters = new URLSearchParams({ artist, title });
  if (durationSec !== null) {
    parameters.set('duration', String(durationSec));
  }
  return lyricsCheckSchema.parse(await request(`/api/youtube/lyrics?${parameters}`));
};

export const addToQueue = async (fileHash: string): Promise<RemoteState> =>
  await post('/api/queue/add', { fileHash });

export const moveInQueue = async (id: string, index: number): Promise<RemoteState> =>
  await post('/api/queue/move', { id, index });

export const removeFromQueue = async (id: string): Promise<RemoteState> =>
  await post('/api/queue/remove', { id });

export const clearQueue = async (): Promise<RemoteState> => await post('/api/queue/clear');

export const importFromYoutube = async (
  videoId: string,
  artist: string,
  title: string,
): Promise<RemoteState> => await post('/api/youtube/import', { videoId, artist, title });

export const loadSetup = async (): Promise<StartSetup> =>
  setupSchema.parse(await request('/api/setup'));

export const sendCommand = async (command: RemoteCommand): Promise<RemoteState> =>
  await post('/api/control', command);

export const thumbnailUrl = (id: string): string => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
