import { analyzeReferenceSamples } from './state';

globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
  const value = event.data;
  const reply = event.ports.at(0);
  if (
    reply === undefined ||
    typeof value !== 'object' ||
    value === null ||
    !('samples' in value) ||
    !(value.samples instanceof Float32Array) ||
    !('sampleRate' in value) ||
    typeof value.sampleRate !== 'number' ||
    !Number.isFinite(value.sampleRate) ||
    value.sampleRate <= 0
  ) {
    throw new TypeError('Invalid reference audio');
  }

  const { singableSec, contour } = analyzeReferenceSamples(value.samples, value.sampleRate);
  reply.postMessage({ singableSec, hopSec: contour.hopSec, semitones: contour.semitones }, [
    contour.semitones.buffer,
  ]);
  reply.close();
});
