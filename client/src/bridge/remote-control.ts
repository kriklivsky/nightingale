import { z } from 'zod';

import { invoke, isTauri, listen, type UnlistenFn } from './runtime';
import { playbackPlayerSchema } from './schemas';

const remoteControlInfoSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('off') }),
  z.object({
    status: z.literal('running'),
    username: z.string(),
    urls: z.array(z.string().regex(/^http:\/\/[0-9.]+:\d+$/)),
  }),
  z.object({ status: z.literal('failed'), error: z.string() }),
]);

const startTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('queue') }),
  z.object({ kind: z.literal('song'), fileHash: z.string().regex(/^[A-Fa-f0-9]{32}$/) }),
]);

const startModeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('solo'),
    microphoneId: z.string().min(1).nullable(),
    profile: z.string().min(1).nullable(),
  }),
  z.object({ kind: z.literal('multiplayer'), players: z.array(playbackPlayerSchema) }),
]);

const volumeSchema = z.number().finite().min(0).max(1);

const remoteCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), target: startTargetSchema, mode: startModeSchema }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('restart') }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('background') }),
  z.object({ type: z.literal('toggleMic') }),
  z.object({ type: z.literal('toggleMonitor') }),
  z.object({ type: z.literal('seek'), deltaSec: z.number().finite().min(-60).max(60) }),
  z.object({ type: z.literal('outputVolume'), value: volumeSchema }),
  z.object({ type: z.literal('guideVolume'), value: volumeSchema }),
  z.object({ type: z.literal('monitorGain'), value: z.number().finite().min(0).max(2) }),
]);

export type RemoteControlInfo = z.infer<typeof remoteControlInfoSchema>;
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;
export type RemoteStartCommand = Extract<RemoteCommand, { type: 'start' }>;

export type RemoteTvStatus =
  | { screen: 'menu' }
  | {
      screen: 'playback';
      fileHash: string;
      title: string;
      artist: string;
      ready: boolean;
      paused: boolean;
      resultOpen: boolean;
      positionSec: number;
      durationSec: number;
      outputVolume: number;
      guideVolume: number;
      guideAvailable: boolean;
      micEnabled: boolean;
      monitorEnabled: boolean;
      multiplayer: boolean;
      canSkip: boolean;
    };

export const loadRemoteControlInfo = async (): Promise<RemoteControlInfo> =>
  remoteControlInfoSchema.parse(await invoke('remote_control_info'));

export const reportRemoteStatus = async (status: RemoteTvStatus): Promise<void> => {
  if (isTauri) {
    await invoke('report_remote_status', { status });
  }
};

export const onRemoteCommand = async (
  callback: (command: RemoteCommand) => void,
): Promise<UnlistenFn> =>
  await listen<unknown>('remote-command', ({ payload }) => {
    const command = remoteCommandSchema.safeParse(payload);
    if (command.success) {
      callback(command.data);
    }
  });
