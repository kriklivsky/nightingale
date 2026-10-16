import type { MicSampleFrame } from '@/types/MicSampleFrame';

export type MicSamplesCallback = (frame: MicSampleFrame) => void;
export type StopListening = () => void;

const subscribers = new Map<string, Set<MicSamplesCallback>>();

export const dispatchMicFrame = (captureId: string, frame: MicSampleFrame): void => {
  for (const callback of subscribers.get(captureId) ?? []) {
    try {
      callback(frame);
    } catch {
      // One consumer must not break microphone delivery to other consumers.
    }
  }
};

export const subscribeMicSamples = (
  captureId: string,
  callback: MicSamplesCallback,
): StopListening => {
  const callbacks = subscribers.get(captureId) ?? new Set<MicSamplesCallback>();
  callbacks.add(callback);
  subscribers.set(captureId, callbacks);
  return () => {
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      subscribers.delete(captureId);
    }
  };
};
