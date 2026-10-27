import { useMutation } from '@tanstack/react-query';
import { useState, type RefObject } from 'react';

import type { ScreenAudioState } from './api';
import { messages } from './messages';
import { screenError } from './peer';
import type { SenderSession } from './sender-session';
import { Button } from './ui';

function audioStatus(audio: ScreenAudioState): string {
  if (!audio.microphone_available) {
    return messages.micUnavailable;
  }
  return audio.microphone_streaming ? messages.micStreaming : messages.micNotStreaming;
}

function currentSession(session: RefObject<SenderSession | null>): SenderSession {
  if (session.current === null) {
    throw new Error(messages.sessionClosed);
  }
  return session.current;
}

export function ScreenMicrophoneControls({
  session,
  audio,
  report,
}: {
  session: RefObject<SenderSession | null>;
  audio: ScreenAudioState;
  report: (message: string) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const failed = (error: unknown): void => report(screenError(error));
  const monitor = useMutation({
    mutationFn: () => currentSession(session).setMonitoring(audio.monitoring !== true),
    onError: failed,
  });
  const access = useMutation({
    mutationFn: () => currentSession(session).microphoneAccess(token === null),
    onSuccess: setToken,
    onError: failed,
  });

  return (
    <section className="w-full space-y-4 rounded-2xl border border-border p-5">
      <h2 className="text-xl font-medium">{messages.microphones}</h2>
      <Button
        className="h-12 px-5"
        variant="outline"
        disabled={audio.monitoring === null || monitor.isPending}
        onClick={() => monitor.mutate()}
      >
        {messages.monitoring(audio.monitoring === true)}
      </Button>
      <p className="text-sm text-muted-foreground">{messages.monitoringHint}</p>
      <Button
        className="h-12 px-5"
        variant="outline"
        disabled={(token === null && !audio.microphone_available) || access.isPending}
        onClick={() => access.mutate()}
      >
        {token === null ? messages.allowPython : messages.revokeAccess}
      </Button>
      <output className="block text-sm text-muted-foreground">{audioStatus(audio)}</output>
      {token !== null && (
        <div className="space-y-3">
          <Button
            className="h-12 px-5"
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                .writeText(token)
                .then(() => report(messages.keyCopied))
                .catch(failed);
            }}
          >
            {messages.copyKey}
          </Button>
          <p className="flex flex-wrap gap-4 text-sm">
            <a className="underline" href="/microphone-client.py" download>
              {messages.downloadClient}
            </a>
            <a className="underline" href="/certificate" download>
              {messages.downloadCertificate}
            </a>
          </p>
          <p className="text-sm text-muted-foreground">{messages.clientHint}</p>
        </div>
      )}
    </section>
  );
}
