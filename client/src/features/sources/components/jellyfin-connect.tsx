import { RemoteSourceConnectDialog } from '@/features/sources/components/connect';
import {
  useConnectJellyfin,
  useJellyfinLogin,
} from '@/features/sources/mutations/use-source-mutations';
import { useI18n } from '@/shared/i18n/use-i18n';

export const JellyfinConnectDialog = () => {
  const { t } = useI18n();
  const loginMutation = useJellyfinLogin();
  const connectMutation = useConnectJellyfin();

  return (
    <RemoteSourceConnectDialog
      mode="jellyfin-connect"
      title={t('source.connectTo', { source: 'Jellyfin' })}
      description={t('source.jellyfinDescription')}
      urlInputId="jelly-url"
      urlPlaceholder="https://jellyfin.example.com"
      usernameInputId="jelly-user"
      passwordInputId="jelly-pass"
      loginMutation={loginMutation}
      connectMutation={connectMutation}
      selection={{
        label: t('source.librariesToImport'),
        emptyMessage: t('source.noLibrariesReported'),
        getItems: (login) =>
          login.libraries.map((library) => ({ id: library.id, label: library.name })),
      }}
    />
  );
};
