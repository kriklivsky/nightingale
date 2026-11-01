import { z } from 'zod';

import type { MicCaptureOptions } from '@/types/MicCaptureOptions';
import type { MicrophoneInfo } from '@/types/MicrophoneInfo';
import type { MicSampleFrame } from '@/types/MicSampleFrame';

import type { MicrophoneAdapter } from './microphone';
import { dispatchMicFrame, subscribeMicSamples } from './microphone-samples';
import { invoke } from './runtime';

const STREAM_OPEN_TIMEOUT_MS = 3000;
const FRAME_HEADER_BYTES = 4;

const streamEndpointSchema = z.object({
  url: z.string().startsWith('ws://127.0.0.1:'),
  token: z.string().min(1),
});

/**
 * Serializes start/stop so React's stop-then-start on song change can't race
 * at the Tauri IPC layer (commands run on a worker pool and would otherwise
 * be free to reorder).
 */
let opChain: Promise<unknown> = Promise.resolve();

const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
  const next = opChain.catch(() => undefined).then(op);
  opChain = next;
  return next;
};

const streams = new Map<string, WebSocket>();

const closeStream = (captureId: string): void => {
  streams.get(captureId)?.close();
  streams.delete(captureId);
};

/** Frames are a little-endian `u32` sample rate followed by `f32` samples. */
const decodeFrame = (data: unknown): MicSampleFrame | null => {
  if (
    !(data instanceof ArrayBuffer) ||
    data.byteLength < FRAME_HEADER_BYTES ||
    data.byteLength % 4 !== 0
  ) {
    return null;
  }
  const view = new DataView(data);
  const samples = Array.from({ length: (data.byteLength - FRAME_HEADER_BYTES) / 4 }, (_, i) =>
    view.getFloat32(FRAME_HEADER_BYTES + i * 4, true),
  );
  return { sample_rate: view.getUint32(0, true), samples };
};

/**
 * Microphone frames arrive over a loopback WebSocket rather than Tauri IPC:
 * WebKitGTK delivers IPC messages on the GTK main thread, which can be busy
 * compositing rendered frames.
 */
const openStream = async (captureId: string): Promise<void> => {
  const { url, token } = streamEndpointSchema.parse(await invoke('mic_stream_endpoint'));
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error('Microphone stream did not open'));
    }, STREAM_OPEN_TIMEOUT_MS);
    socket.onopen = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    socket.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Microphone stream is unavailable'));
    };
  });
  socket.onmessage = (event: MessageEvent<unknown>) => {
    const frame = decodeFrame(event.data);
    if (frame) {
      dispatchMicFrame(captureId, frame);
    }
  };
  socket.send(JSON.stringify({ token, captureId }));
  streams.set(captureId, socket);
};

const listDevices = (combineChannels: boolean): Promise<MicrophoneInfo[]> =>
  invoke<MicrophoneInfo[]>('list_microphones', { combineChannels });

const startCapture = (
  captureId: string,
  preferred: string | null,
  options: MicCaptureOptions,
): Promise<string> =>
  enqueue(async () => {
    closeStream(captureId);
    await openStream(captureId);
    try {
      return await invoke<string>('start_mic_capture', { captureId, preferred, options });
    } catch (error) {
      closeStream(captureId);
      throw error;
    }
  });

const stopCapture = (captureId: string): Promise<void> =>
  enqueue(async () => {
    closeStream(captureId);
    await invoke('stop_mic_capture', { captureId });
  });

export const tauriMicrophoneAdapter: MicrophoneAdapter = {
  listDevices,
  startCapture,
  stopCapture,
  updateCaptureOptions: (captureId, options) =>
    enqueue(async () => {
      await invoke('update_mic_capture_options', { captureId, options });
    }),
  subscribe: async (captureId, callback) => subscribeMicSamples(captureId, callback),
};
