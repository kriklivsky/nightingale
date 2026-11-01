import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Toaster } from '@/shared/components/ui/sonner';
import { Spinner } from '@/shared/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { en } from '@/shared/i18n/locales/en';
import { ru } from '@/shared/i18n/locales/ru';
import { createTranslator, resolveLocale } from '@/shared/i18n/translator';
import { I18nContext, useI18n, type I18nValue } from '@/shared/i18n/use-i18n';

import { isSignedOut, signOut, type RemoteState } from './api';
import { ErrorText } from './error-text';
import { LibraryPanel } from './library-panel';
import { LoginScreen } from './login-screen';
import { NowPlaying } from './now-playing';
import { QueuePanel } from './queue-panel';
import { StartDialog, type StartRequest } from './start-dialog';
import { useRemoteState } from './use-remote';
import { YoutubePanel } from './youtube-panel';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (failures, error) => failures < 1 && !isSignedOut(error) },
  },
});

type RemoteTabsProps = {
  state: RemoteState | undefined;
  loading: boolean;
  onStart: (request: StartRequest) => void;
};

function RemoteTabs({ state, loading, onStart }: RemoteTabsProps) {
  const { t } = useI18n();
  const queue = state?.queue ?? [];
  const canStart = state?.tv?.screen !== 'playback';

  return (
    <Tabs defaultValue="queue">
      <TabsList className="h-11 w-full">
        <TabsTrigger value="queue" className="text-sm">
          {t('library.queue')} ({queue.length})
        </TabsTrigger>
        <TabsTrigger value="library" className="text-sm">
          {t('remote.tab.library')}
        </TabsTrigger>
        <TabsTrigger value="youtube" className="text-sm">
          YouTube
        </TabsTrigger>
      </TabsList>
      <TabsContent value="queue" className="mt-2">
        {loading ? (
          <Spinner className="mx-auto my-10 size-6" />
        ) : (
          <QueuePanel
            queue={queue}
            canStart={canStart}
            onStart={() => onStart({ kind: 'queue' })}
          />
        )}
      </TabsContent>
      <TabsContent value="library" className="mt-2">
        <LibraryPanel
          canStart={canStart}
          onStart={(fileHash, title) => onStart({ kind: 'song', fileHash, title })}
        />
      </TabsContent>
      <TabsContent value="youtube" className="mt-2">
        <YoutubePanel imports={state?.imports ?? []} />
      </TabsContent>
    </Tabs>
  );
}

const leave = () => {
  void signOut()
    .catch(() => undefined)
    .then(() => window.location.replace('/'));
};

function RemoteScreen() {
  const { t } = useI18n();
  const { data, error, isError, isLoading } = useRemoteState();
  const [startRequest, setStartRequest] = useState<StartRequest | null>(null);

  if (isSignedOut(error)) {
    return <LoginScreen />;
  }

  return (
    <main className="mx-auto flex h-svh max-w-xl flex-col overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('remote.title')}</h1>
        <Button variant="ghost" className="h-9 text-sm" onClick={leave}>
          {t('remote.signOut')}
        </Button>
      </header>
      {isError ? <ErrorText error={error} /> : null}
      {data?.tv?.screen === 'playback' ? (
        <NowPlaying tv={data.tv} monitorGain={data.monitorGain} />
      ) : null}
      <RemoteTabs state={data} loading={isLoading} onStart={setStartRequest} />
      <StartDialog request={startRequest} onClose={() => setStartRequest(null)} />
    </main>
  );
}

export function RemoteApp() {
  const locale = resolveLocale('system', navigator.languages);
  const value = useMemo<I18nValue>(
    () => ({ locale, t: createTranslator(locale, locale === 'ru' ? ru : en) }),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = value.t('remote.title');
  }, [locale, value]);

  return (
    <I18nContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        <RemoteScreen />
        <Toaster position="top-center" />
      </QueryClientProvider>
    </I18nContext.Provider>
  );
}
