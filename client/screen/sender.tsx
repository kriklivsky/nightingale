import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { pairScreen, type ScreenAudioState, type ScreenPairing } from './api';
import { messages } from './messages';
import { ScreenMicrophoneControls } from './microphone-controls';
import { defaultScreenQuality, screenError, screenQualities } from './peer';
import { SenderSession } from './sender-session';
import { Button } from './ui';

function ShareControls({
  pairing,
  ended,
  report,
}: {
  pairing: ScreenPairing;
  ended: () => void;
  report: (message: string) => void;
}) {
  const session = useRef<SenderSession | null>(null);
  const [started, setStarted] = useState(false);
  const [quality, setQuality] = useState(defaultScreenQuality);
  const [audio, setAudio] = useState<ScreenAudioState>({
    monitoring: null,
    microphone_available: false,
    microphone_streaming: false,
  });

  useEffect(() => {
    const current = new SenderSession(pairing, report, ended, setAudio);
    session.current = current;
    current.heartbeat();
    return () => {
      current.dispose();
      session.current = null;
    };
  }, [pairing, report, ended]);

  const start = (): void => {
    setStarted(true);
    void session.current?.start(quality).catch((error: unknown) => report(screenError(error)));
  };

  return (
    <div className="flex flex-wrap gap-4">
      <label className="flex items-center gap-3">
        <span>{messages.quality}</span>
        <select
          className="h-12 rounded-lg border border-input bg-background px-4"
          value={quality.id}
          disabled={started}
          onChange={(event) =>
            setQuality(
              screenQualities.find((option) => option.id === event.target.value) ??
                defaultScreenQuality,
            )
          }
        >
          {screenQualities.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <Button className="h-12 px-6 text-base" onClick={start} disabled={started}>
        {started ? messages.sharing : messages.chooseScreen}
      </Button>
      <Button
        className="h-12 px-6 text-base"
        variant="outline"
        onClick={() => {
          void session.current?.stop().catch((error: unknown) => report(screenError(error)));
        }}
      >
        {messages.disconnect}
      </Button>
      <ScreenMicrophoneControls session={session} audio={audio} report={report} />
    </div>
  );
}

export function ScreenSender() {
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState<ScreenPairing | null>(null);
  const [message, setMessage] = useState('');
  const ended = useCallback(() => setPairing(null), []);
  const pair = useMutation({
    mutationFn: pairScreen,
    onSuccess: (value) => {
      setPairing(value);
      setMessage(messages.paired);
    },
  });
  const supported =
    window.isSecureContext && typeof navigator.mediaDevices.getDisplayMedia === 'function';

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-8 p-6 sm:p-12">
      <header className="space-y-3">
        <p className="text-sm font-medium text-primary">{messages.eyebrow}</p>
        <h1 className="text-4xl font-semibold tracking-tight">{messages.heading}</h1>
        <p className="text-lg text-muted-foreground">{messages.intro}</p>
      </header>
      {!supported && (
        <p role="alert" className="rounded-xl border border-destructive p-5">
          {messages.unsupported}
        </p>
      )}
      {pairing === null ? (
        <form
          className="space-y-5 rounded-2xl border border-border bg-card p-6"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage('');
            pair.mutate(code);
          }}
        >
          <label className="block space-y-3" htmlFor="screen-code">
            <span className="text-lg">{messages.codeLabel}</span>
            <input
              id="screen-code"
              className="block w-full rounded-lg border border-input bg-background p-4 text-3xl tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-ring"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              required
            />
          </label>
          <Button className="h-12 px-6 text-base" disabled={!supported || pair.isPending} submit>
            {pair.isPending ? messages.connecting : messages.connect}
          </Button>
          {pair.isError && <p role="alert">{screenError(pair.error)}</p>}
        </form>
      ) : (
        <ShareControls pairing={pairing} ended={ended} report={setMessage} />
      )}
      {message !== '' && <output className="text-lg">{message}</output>}
      <aside className="space-y-3 text-sm text-muted-foreground">
        <p>{messages.note4k}</p>
        <p>{messages.noteAudio}</p>
        <p>{messages.notePrivacy}</p>
      </aside>
    </main>
  );
}
