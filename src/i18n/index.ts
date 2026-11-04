import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../locales/en/translation.json';
import si from '../../locales/si/translation.json';
import ta from '../../locales/ta/translation.json';
import { Lang, useSettings } from '../store/stores';

export const LANGS: { id: Lang; native: string; locale: string }[] = [
  { id: 'en', native: 'English', locale: 'en-LK' },
  { id: 'si', native: 'සිංහල', locale: 'si-LK' },
  { id: 'ta', native: 'தமிழ்', locale: 'ta-LK' },
];

export const localeOf = (l: string) => LANGS.find((x) => x.id === l)?.locale ?? 'en-LK';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, si: { translation: si }, ta: { translation: ta } },
  lng: useSettings.getState().lang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

function applyLang(l: Lang) {
  document.documentElement.lang = l;
  document.documentElement.dataset.lang = l;
}
applyLang(useSettings.getState().lang);

useSettings.subscribe((s, prev) => {
  if (s.lang !== prev.lang) {
    void i18n.changeLanguage(s.lang);
    applyLang(s.lang);
  }
});

export function fmtNumber(n: number, lang = i18n.language): string {
  try {
    return new Intl.NumberFormat(localeOf(lang)).format(n);
  } catch {
    return String(n);
  }
}

export function fmtDate(ts: number, lang = i18n.language): string {
  try {
    return new Intl.DateTimeFormat(localeOf(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export default i18n;
