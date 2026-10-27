import type { en } from './locales/en';

export type Locale = 'en' | 'ru';

export type UiLanguageSetting = Locale | 'system';

export type PluralMessage = {
  one: string;
  few?: string;
  many?: string;
  other: string;
};

export type Message = string | PluralMessage;

export type MessageKey = keyof typeof en;

export type Messages = Readonly<Record<MessageKey, Message>>;

export type MessageParams = Readonly<Record<string, string | number | bigint>>;

export type Translate = (key: MessageKey, params?: MessageParams) => string;

export const UI_LANGUAGE_SETTINGS: readonly UiLanguageSetting[] = ['system', 'en', 'ru'];

export function parseUiLanguage(value: string | null | undefined): UiLanguageSetting {
  return value === 'en' || value === 'ru' ? value : 'system';
}

export function resolveLocale(
  setting: UiLanguageSetting,
  systemLanguages: readonly string[],
): Locale {
  if (setting !== 'system') {
    return setting;
  }
  return systemLanguages.some((language) => language.toLowerCase().startsWith('ru')) ? 'ru' : 'en';
}

function pluralForm(message: PluralMessage, rules: Intl.PluralRules, count: number): string {
  const category = rules.select(count);
  if (category === 'one') {
    return message.one;
  }
  if (category === 'few') {
    return message.few ?? message.other;
  }
  if (category === 'many') {
    return message.many ?? message.other;
  }
  return message.other;
}

function interpolate(template: string, params: MessageParams | undefined): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

export function createTranslator(locale: Locale, messages: Messages): Translate {
  const rules = new Intl.PluralRules(locale);

  return (key, params) => {
    const message = messages[key];
    if (typeof message === 'string') {
      return interpolate(message, params);
    }
    const count = Number(params?.count ?? 0);
    return interpolate(pluralForm(message, rules, count), params);
  };
}
