import { z } from 'zod';

const generationSchema = z.number().int().nonnegative();
const sdpSchema = z.string().max(100_000).nullable();

const pairingSchema = z.object({
  token: z.string().min(32).max(128),
  generation: generationSchema,
});

const senderStateSchema = z.object({ generation: generationSchema, answer: sdpSchema });

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
    throw new Error(message || `Ошибка подключения: HTTP ${response.status}`);
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
}
