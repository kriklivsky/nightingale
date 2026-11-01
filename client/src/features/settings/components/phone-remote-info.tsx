import { useQuery } from '@tanstack/react-query';

import { loadRemoteControlInfo } from '@/bridge/remote-control';
import { Hint } from '@/features/settings/components/settings-controls';
import { Field } from '@/shared/components/ui/field';
import { Label } from '@/shared/components/ui/label';
import { useI18n } from '@/shared/i18n/use-i18n';
import { REMOTE_CONTROL } from '@/shared/query-keys';

export function PhoneRemoteInfo() {
  const { t } = useI18n();
  const { data: info } = useQuery({
    queryKey: REMOTE_CONTROL,
    queryFn: loadRemoteControlInfo,
    refetchInterval: 10_000,
  });

  if (info === undefined || info.status === 'off') {
    return null;
  }

  return (
    <Field>
      <Label>{t('settings.phoneRemote')}</Label>
      {info.status === 'failed' ? (
        <Hint>{t('settings.phoneRemoteFailed', { detail: info.error })}</Hint>
      ) : (
        <>
          {info.urls.length === 0 ? (
            <Hint>{t('settings.phoneRemoteNoNetwork')}</Hint>
          ) : (
            <ul className="space-y-1 font-mono text-base">
              {info.urls.map((url) => (
                <li key={url}>{url}</li>
              ))}
            </ul>
          )}
          <Hint>{t('settings.phoneRemoteLogin', { username: info.username })}</Hint>
        </>
      )}
    </Field>
  );
}
