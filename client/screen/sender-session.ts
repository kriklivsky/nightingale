import { ScreenSignaling, type ScreenPairing } from './api';
import {
  createScreenPeer,
  gatherIce,
  pollScreen,
  preferH264,
  screenError,
  type ScreenQuality,
} from './peer';

export class SenderSession {
  private readonly abort = new AbortController();
  private readonly api: ScreenSignaling;
  private peer: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private starting = false;
  private stopping = false;

  constructor(
    private readonly pairing: ScreenPairing,
    private readonly report: (message: string) => void,
    private readonly ended: () => void,
  ) {
    this.api = new ScreenSignaling('', pairing.token);
  }

  heartbeat(): void {
    pollScreen(
      () => this.poll(),
      this.abort.signal,
      (error) => {
        this.report(screenError(error));
        this.dispose();
        this.ended();
      },
    );
  }

  private async poll(): Promise<void> {
    const state = await this.api.senderState(this.abort.signal);
    if (state.answer !== null && this.peer?.remoteDescription === null) {
      await this.peer.setRemoteDescription({ type: 'answer', sdp: state.answer });
    }
  }

  async start(quality: ScreenQuality): Promise<void> {
    if (this.starting || this.stream !== null) {
      return;
    }
    this.starting = true;
    try {
      const options = {
        video: {
          width: { ideal: quality.width },
          height: { ideal: quality.height },
          frameRate: { ideal: quality.fps, max: quality.fps },
        },
        audio: true,
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(options);
      if (this.abort.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      await this.connect(stream, quality.bitrate);
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.report(screenError(error));
        await this.stop().catch((failure: unknown) => this.report(screenError(failure)));
      }
    } finally {
      this.starting = false;
    }
  }

  private async connect(stream: MediaStream, bitrate: number): Promise<void> {
    const peer = createScreenPeer();
    this.peer = peer;
    for (const track of stream.getTracks()) {
      peer.addTrack(track, stream);
      track.addEventListener(
        'ended',
        (): void => {
          void this.stop().catch((error: unknown) => this.report(screenError(error)));
        },
        { signal: this.abort.signal },
      );
    }
    preferH264(peer);
    peer.addEventListener(
      'connectionstatechange',
      (): void => {
        if (peer.connectionState === 'connected') {
          this.report(
            stream.getAudioTracks().length === 0
              ? 'Экран передаётся без звука. Для звука выберите вкладку и включите «Передавать звук».'
              : 'Экран и звук передаются на телевизор.',
          );
        } else if (peer.connectionState === 'failed') {
          this.report(
            'Не удалось установить прямую связь. Проверьте сеть и изоляцию Wi-Fi клиентов.',
          );
          void this.stop().catch((error: unknown) => this.report(screenError(error)));
        }
      },
      { signal: this.abort.signal },
    );
    await peer.setLocalDescription(await peer.createOffer());
    await Promise.all(
      peer
        .getSenders()
        .filter((sender) => sender.track?.kind === 'video')
        .map(async (sender) => {
          const parameters = sender.getParameters();
          parameters.degradationPreference = 'maintain-resolution';
          for (const encoding of parameters.encodings) {
            encoding.maxBitrate = bitrate;
          }
          await sender.setParameters(parameters);
        }),
    );
    const sdp = await gatherIce(peer, this.abort.signal);
    if (!this.abort.signal.aborted) {
      await this.api.describe('offer', this.pairing.generation, sdp);
      this.report('Подключаем телевизор…');
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    this.dispose();
    try {
      await this.api.disconnect();
    } finally {
      this.ended();
    }
  }

  dispose(): void {
    this.abort.abort();
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    if (this.peer !== null) {
      this.peer.close();
      this.peer = null;
    }
  }
}
