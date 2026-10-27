import { RemoteSourceConnectDialog } from '@/features/sources/components/connect';
import {
  useConnectNavidrome,
  useNavidromeLogin,
} from '@/features/sources/mutations/use-source-mutations';
import { useI18n } from '@/shared/i18n/use-i18n';

export const NavidromeConnectDialog = () => {
  const { t } = useI18n();
  const loginMutation = useNavidromeLogin();
  const connectMutation = useConnectNavidrome();

  return (
    <RemoteSourceConnectDialog
      mode="navidrome-connect"
      title={t('source.connectTo', { source: 'Navidrome' })}
      description={t('source.navidromeDescription')}
      urlInputId="navi-url"
      urlPlaceholder="https://navidrome.example.com"
      usernameInputId="navi-user"
      passwordInputId="navi-pass"
      loginMutation={loginMutation}
      connectMutation={connectMutation}
    />
  );
};
