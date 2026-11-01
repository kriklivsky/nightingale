import { useState, type FormEvent } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Spinner } from '@/shared/components/ui/spinner';
import { useI18n } from '@/shared/i18n/use-i18n';

import { signIn } from './api';

const field = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};

export function LoginScreen() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    void signIn(field(data, 'username'), field(data, 'password'))
      .then(() => {
        window.location.replace('/');
        return undefined;
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setBusy(false);
      });
  };

  return (
    <main className="mx-auto flex h-svh max-w-sm flex-col justify-center px-4">
      <form
        method="post"
        action="/api/login"
        className="flex flex-col gap-4 rounded-lg border p-5"
        onSubmit={submit}
      >
        <h1 className="text-lg font-semibold">{t('remote.signInTitle')}</h1>
        <div className="flex flex-col gap-1">
          <Label htmlFor="remote-username">{t('remote.username')}</Label>
          <Input
            id="remote-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className="h-11 text-base"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="remote-password">{t('remote.password')}</Label>
          <Input
            id="remote-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-11 text-base"
          />
        </div>
        {error === null ? null : (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="h-11 text-sm" disabled={busy}>
          {busy ? <Spinner /> : null} {t('remote.signIn')}
        </Button>
      </form>
    </main>
  );
}
