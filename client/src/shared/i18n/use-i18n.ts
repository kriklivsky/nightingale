import { createContext, useContext } from 'react';

import type { Locale, Translate } from './translator';

export type I18nValue = {
  locale: Locale;
  t: Translate;
};

export const I18nContext = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return value;
}
