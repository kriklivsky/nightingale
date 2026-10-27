import { getLanguageName } from '@/features/lyrics/lib/languages';
import { useI18n } from '@/shared/i18n/use-i18n';

const UNKNOWN_LANGUAGE_CODES = new Set(['un', 'und', 'unk', 'unknown']);

/** Whether a language is concrete enough to surface in the UI. Provided LRC
 * songs default to "unknown", which we hide rather than show as "UN". */
export function isDisplayableLanguage(language?: string | null): language is string {
  return (
    typeof language === 'string' &&
    language !== '' &&
    !UNKNOWN_LANGUAGE_CODES.has(language.trim().toLowerCase())
  );
}

export function LanguageBadge({ language }: { language?: string | null }) {
  const { t, locale } = useI18n();
  if (!isDisplayableLanguage(language)) {
    return null;
  }

  const shortCode = language.slice(0, 2).toUpperCase();
  const name = getLanguageName(language, locale);

  return (
    <span
      className="inline-grid size-5 shrink-0 place-items-center rounded-sm bg-foreground/8 p-0 text-center font-mono text-[0.5625rem] leading-none font-semibold tracking-tight text-muted-foreground ring-1 ring-foreground/10 ring-inset"
      title={name}
      aria-label={t('song.language', { language: name })}
    >
      {shortCode}
    </span>
  );
}
