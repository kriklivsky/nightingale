import { messages } from './messages';

export function screenError(error: unknown): string {
  return error instanceof Error ? error.message : messages.genericError;
}

export type ScreenQuality = {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
};

export const defaultScreenQuality: ScreenQuality = {
  id: '1080p30',
  label: messages.quality1080p30,
  width: 1920,
  height: 1080,
  fps: 30,
  bitrate: 8_000_000,
};

export const screenQualities: readonly ScreenQuality[] = [
  defaultScreenQuality,
  {
    id: '4k30',
    label: messages.quality4k30,
    width: 3840,
    height: 2160,
    fps: 30,
    bitrate: 20_000_000,
  },
  {
    id: '4k60',
    label: messages.quality4k60,
    width: 3840,
    height: 2160,
    fps: 60,
    bitrate: 35_000_000,
  },
];

export function pollScreen(
  action: () => Promise<void>,
  signal: AbortSignal,
  onError: (error: unknown) => void,
): void {
  let timer: number | undefined;
  const schedule = (): void => {
    if (!signal.aborted) {
      timer = window.setTimeout(tick, 500);
    }
  };
  const failed = (error: unknown): void => {
    if (!signal.aborted) {
      onError(error);
      schedule();
    }
  };
  const tick = (): void => {
    if (!signal.aborted) {
      void action().then(schedule).catch(failed);
    }
  };
  signal.addEventListener('abort', () => window.clearTimeout(timer), { once: true });
  tick();
}

export function gatherIce(peer: RTCPeerConnection, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      window.clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', changed);
      signal.removeEventListener('abort', abort);
    };
    const abort = (): void => {
      cleanup();
      reject(new DOMException('Connection closed', 'AbortError'));
    };
    const changed = (): void => {
      if (peer.iceGatheringState !== 'complete') {
        return;
      }
      cleanup();
      const sdp = peer.localDescription?.sdp;
      if (sdp === undefined || sdp === '') {
        reject(new Error(messages.noSdp));
      } else {
        resolve(sdp);
      }
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(messages.noRoute));
    }, 10_000);
    peer.addEventListener('icegatheringstatechange', changed);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
    } else {
      changed();
    }
  });
}

export function createScreenPeer(): RTCPeerConnection {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new TypeError(messages.noWebrtc);
  }
  return new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
}

export function preferH264(peer: RTCPeerConnection): void {
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs;
  if (codecs === undefined) {
    return;
  }
  const ordered = codecs.toSorted(
    (left, right) =>
      Number(right.mimeType === 'video/H264') - Number(left.mimeType === 'video/H264'),
  );
  for (const transceiver of peer.getTransceivers()) {
    if (transceiver.receiver.track.kind === 'video') {
      transceiver.setCodecPreferences(ordered);
    }
  }
}
