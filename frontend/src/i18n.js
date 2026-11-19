import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import de from './locales/de.json';
import en from './locales/en.json';
import ro from './locales/ro.json';
import salesEn from './locales/sales.en.json';
import salesDe from './locales/sales.de.json';
import shellEn from './locales/shell.en.json';
import shellDe from './locales/shell.de.json';
import shellRo from './locales/shell.ro.json';
import onboardingEn from './locales/onboarding.en.json';
import onboardingDe from './locales/onboarding.de.json';
import screensDe from './locales/screens.de.json';
import screensEn from './locales/screens.en.json';
import screensRo from './locales/screens.ro.json';
import opsDe from './locales/ops.de.json';
import opsEn from './locales/ops.en.json';
import accountDe from './locales/account.de.json';
import accountEn from './locales/account.en.json';
import accountRo from './locales/account.ro.json';
import filesDe from './locales/files.de.json';
import filesEn from './locales/files.en.json';
import filesRo from './locales/files.ro.json';
import subDe from './locales/sub.de.json';
import subEn from './locales/sub.en.json';
import subRo from './locales/sub.ro.json';
import calcDe from './locales/calc.de.json';
import calcEn from './locales/calc.en.json';
import calcRo from './locales/calc.ro.json';
import qmDe from './locales/qm.de.json';
import qmEn from './locales/qm.en.json';
import qmRo from './locales/qm.ro.json';
import timeDe from './locales/time.de.json';
import timeEn from './locales/time.en.json';
import timeRo from './locales/time.ro.json';
import blanketDe from './locales/blanket.de.json';
import blanketEn from './locales/blanket.en.json';
import blanketRo from './locales/blanket.ro.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: { ...de, sales: salesDe, shell: shellDe, onboarding: onboardingDe, screens: screensDe, ops: opsDe, account: accountDe, files: filesDe, sub: subDe, calc: calcDe, qm: qmDe, time: timeDe, blanket: blanketDe } },
      en: { translation: { ...en, sales: salesEn, shell: shellEn, onboarding: onboardingEn, screens: screensEn, ops: opsEn, account: accountEn, files: filesEn, sub: subEn, calc: calcEn, qm: qmEn, time: timeEn, blanket: blanketEn, roles: { ...en.roles, material_planner: 'Material Planner', sales: 'Sales', accounting: 'Accounting' } } },
      ro: { translation: { ...ro, sales: salesEn, shell: shellRo, onboarding: onboardingEn, screens: screensRo, ops: opsEn, account: accountRo, files: filesRo, sub: subRo, calc: calcRo, qm: qmRo, time: timeRo, blanket: blanketRo, roles: { ...ro.roles, sales: 'Vânzări', accounting: 'Contabilitate' } } },
    },
    supportedLngs: ['de', 'en', 'ro'],
    nonExplicitSupportedLngs: true,
    // German is the main language; Romanian screens fall back to English where a text is missing.
    fallbackLng: { ro: ['en'], default: ['de'] },
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

// Keep <html lang> in sync (screen readers, hyphenation, browser translation).
const setHtmlLang = (lng) => { if (typeof document !== 'undefined') document.documentElement.lang = (lng || 'de').slice(0, 2); };
setHtmlLang(i18n.resolvedLanguage);
i18n.on('languageChanged', setHtmlLang);

export default i18n;
