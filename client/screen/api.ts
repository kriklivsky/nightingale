import { z } from 'zod';

import { messages } from './messages';

const generationSchema = z.number().int().nonnegative();
const sdpSchema = z.string().max(100_000).nullable();

const pairingSchema = z.object({
  token: z.string().min(32).max(128),
  generation: generationSchema,
});

const senderStateSchema = z.object({
  generation: generationSchema,
  answer: sdpSchema,
  monitoring: z.boolean().nullable(),
  microphone_available: z.boolean(),
  microphone_streaming: z.boolean(),
});

const microphoneAccessSchema = z.object({
  token: z
    .string()
    .regex(/^[\w-]{43}$/)
    .nullable(),
});

export type ScreenPairing = z.infer<typeof pairingSchema>;

async function request(
  endpoint: string,
  path: string,
  options: { token?: string; body?: unknown; signal?: AbortSignal },
): Promise<unknown> {
  const response = await fetch(`${endpoint}/api/${path}`, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal:
      options.signal === undefined
        ? AbortSignal.timeout(8000)
        : AbortSignal.any([options.signal, AbortSignal.timeout(8000)]),
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 300);
    throw new Error(message || messages.httpError(response.status));
  }
  return response.json();
}

export async function pairScreen(code: string): Promise<ScreenPairing> {
  return pairingSchema.parse(await request('', 'pair', { body: { code } }));
}

export class ScreenSignaling {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  async senderState(signal: AbortSignal): Promise<z.infer<typeof senderStateSchema>> {
    return senderStateSchema.parse(
      await request(this.endpoint, 'state', { token: this.token, signal }),
    );
  }

  async describe(kind: 'offer' | 'answer', generation: number, sdp: string): Promise<void> {
    await request(this.endpoint, kind, { token: this.token, body: { generation, sdp } });
  }

  async disconnect(): Promise<void> {
    await request(this.endpoint, 'disconnect', { token: this.token, body: {} });
  }

  async monitoring(enabled: boolean): Promise<void> {
    await request(this.endpoint, 'monitoring', { token: this.token, body: { enabled } });
  }

  async microphoneAccess(enabled: boolean): Promise<string | null> {
    const value = microphoneAccessSchema.parse(
      await request(this.endpoint, 'microphone-access', { token: this.token, body: { enabled } }),
    );
    return value.token;
  }
}

export type ScreenAudioState = Pick<
  z.infer<typeof senderStateSchema>,
  'monitoring' | 'microphone_available' | 'microphone_streaming'
>;
