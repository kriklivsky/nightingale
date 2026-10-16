export function analyzeReferenceDuration(
  reference: AudioBuffer,
  signal: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./reference-duration.worker.ts', import.meta.url), {
      type: 'module',
    });
    const channel = new MessageChannel();
    const cleanup = (): void => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
      channel.port1.close();
      channel.port2.close();
    };
    const abort = (): void => {
      cleanup();
      reject(new DOMException('Playback preparation cancelled', 'AbortError'));
    };
    const failed = (): void => {
      cleanup();
      reject(new Error('Could not prepare pitch scoring. Reopen the song to retry.'));
    };

    worker.addEventListener('error', failed);
    worker.addEventListener('messageerror', failed);
    channel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > reference.duration + 0.001
      ) {
        failed();
        return;
      }
      cleanup();
      resolve(value);
    });
    channel.port1.addEventListener('messageerror', failed);
    channel.port1.start();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }

    try {
      const samples = reference.getChannelData(0).slice();
      worker.postMessage({ samples, sampleRate: reference.sampleRate }, [
        samples.buffer,
        channel.port2,
      ]);
    } catch {
      failed();
    }
  });
}
