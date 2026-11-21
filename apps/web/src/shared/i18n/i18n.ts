import { useUnit } from 'effector-react';
import { createBrowserPreference } from '../browser/preferences';
import type { ErrorCode } from '../http/api';
import { en } from './en';
import { ru, type MessageKey } from './ru';

export type { MessageKey } from './ru';

export const locales = ['ru', 'en'] as const;
export type Locale = (typeof locales)[number];
type MessageValues = Readonly<Record<string, string | number>>;
const defaultLocale: Locale = 'ru';

const messages: Record<Locale, Record<MessageKey, string> & Record<`error.${ErrorCode}`, string>> = { ru, en };

export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => value === locale);
}

const preference = createBrowserPreference<Locale>(
  'kuroko-locale-v1', defaultLocale, (value) => isLocale(value) ? value : defaultLocale, String,
);

export const $locale = preference.$value;
export const localeChanged = preference.changed;

function forLocale(locale: Locale) {
  const number = new Intl.NumberFormat(locale);
  const plural = new Intl.PluralRules(locale);
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' });
  const decimalSeparator = number.formatToParts(1.1).find(({ type }) => type === 'decimal')?.value ?? '.';

  function t(key: MessageKey, values?: MessageValues) {
    const template = messages[locale][key];
    return values ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match)) : template;
  }

  return { locale, t, number, plural, clock, date, decimalSeparator };
}

const i18n = { ru: forLocale('ru'), en: forLocale('en') } satisfies Record<Locale, ReturnType<typeof forLocale>>;

export function useI18n() {
  return i18n[useUnit($locale)];
}
