import { russian } from './ru';

export type LanguagePreference = 'ru' | 'en' | 'auto';
export type MessageKey = keyof typeof russian;
let language: 'ru' | 'en' = 'en';

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'ru' || value === 'en' || value === 'auto';
}

export function setLanguage(preference: LanguagePreference, obsidianLanguage = 'en'): void {
  language =
    preference === 'auto'
      ? obsidianLanguage.toLowerCase().startsWith('ru')
        ? 'ru'
        : 'en'
      : preference;
}

export function getLocale(): string {
  return language === 'ru' ? 'ru-RU' : 'en';
}

export function t(
  key: MessageKey,
  parameters: Record<string, string | number | undefined> = {},
): string {
  const message = language === 'ru' ? russian[key] : key;
  return message.replace(/\{(\d+)\}/gu, (_, name: string) => String(parameters[name] ?? ''));
}
