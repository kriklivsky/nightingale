import { useEffect, useMemo, type ReactNode } from 'react';

import { useConfig } from '@/shared/config/use-config';

import { en } from './locales/en';
import { ru } from './locales/ru';
import {
  createTranslator,
  parseUiLanguage,
  resolveLocale,
  type Locale,
  type Messages,
} from './translator';
import { I18nContext, type I18nValue } from './use-i18n';

const MESSAGES: Readonly<Record<Locale, Messages>> = { en, ru };

export function I18nProvider({ children }: { children: ReactNode }) {
  const { data: config } = useConfig();
  const locale = resolveLocale(parseUiLanguage(config?.ui_language), navigator.languages);
  const value = useMemo<I18nValue>(
    () => ({ locale, t: createTranslator(locale, MESSAGES[locale]) }),
    [locale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
