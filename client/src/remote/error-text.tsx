import { useI18n } from '@/shared/i18n/use-i18n';

export function ErrorText({ error }: { error: unknown }) {
  const { t } = useI18n();

  return (
    <p className="text-sm text-destructive" role="alert">
      {t('remote.loadFailed', {
        detail: error instanceof Error ? error.message : String(error),
      })}
    </p>
  );
}
