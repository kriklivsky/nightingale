import type { ReferenceAnalysis } from './state';

export class ReferenceAnalysisError extends Error {
  constructor() {
    super('Could not prepare pitch scoring');
    this.name = 'ReferenceAnalysisError';
  }
}

const isFiniteBetween = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function parseAnalysis(value: unknown, reference: AudioBuffer): ReferenceAnalysis | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const limit = reference.duration + 0.001;
  const singableSec = 'singableSec' in value ? value.singableSec : undefined;
  const hopSec = 'hopSec' in value ? value.hopSec : undefined;
  const semitones = 'semitones' in value ? value.semitones : undefined;
  if (
    !isFiniteBetween(singableSec, 0, limit) ||
    !isFiniteBetween(hopSec, Number.MIN_VALUE, limit) ||
    !(semitones instanceof Float32Array) ||
    semitones.length * hopSec > limit
  ) {
    return null;
  }
  return { singableSec, contour: { hopSec, semitones } };
}

export function analyzeReference(
  reference: AudioBuffer,
  signal: AbortSignal,
): Promise<ReferenceAnalysis> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./reference-analysis.worker.ts', import.meta.url), {
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
      reject(new ReferenceAnalysisError());
    };

    worker.addEventListener('error', failed);
    worker.addEventListener('messageerror', failed);
    channel.port1.addEventListener('message', (event: MessageEvent<unknown>) => {
      const analysis = parseAnalysis(event.data, reference);
      if (analysis === null) {
        failed();
        return;
      }
      cleanup();
      resolve(analysis);
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
