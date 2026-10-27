import type { Locale } from '@/shared/i18n/translator';

export const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Mandarin'],
  ['yue', 'Cantonese'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
  ['nl', 'Dutch'],
  ['pl', 'Polish'],
  ['sv', 'Swedish'],
  ['tr', 'Turkish'],
  ['uk', 'Ukrainian'],
  ['cs', 'Czech'],
  ['ro', 'Romanian'],
  ['hu', 'Hungarian'],
] as const;

const LANGUAGE_NAMES = new Map<string, string>(LANGUAGES);

const LANGUAGE_CODE = /^[a-z]{2,3}$/;

/** Display name in the UI locale; English names come from the curated list above. */
export function getLanguageName(language: string, locale: Locale): string {
  const code = language.toLowerCase();
  if (locale !== 'en' && LANGUAGE_CODE.test(code)) {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code);
    if (name !== undefined && name !== code) {
      return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    }
  }
  return LANGUAGE_NAMES.get(code) ?? language.toUpperCase();
}
