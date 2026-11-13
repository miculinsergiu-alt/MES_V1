import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import ro from './locales/ro.json';
import salesEn from './locales/sales.en.json';
import salesDe from './locales/sales.de.json';
import shellEn from './locales/shell.en.json';
import shellDe from './locales/shell.de.json';
import shellRo from './locales/shell.ro.json';
import onboardingEn from './locales/onboarding.en.json';
import onboardingDe from './locales/onboarding.de.json';

// German: so far the sales & invoicing area, login and roles; everything else
// falls back to English until the full German translation (Phase 2).
const de = {
  sales: salesDe,
  shell: shellDe,
  onboarding: onboardingDe,
  login: {
    title: 'NOVA', subtitle: 'ERP für Fertigungsunternehmen: Planung, Produktion, Verkauf und Rechnungen.',
    company: 'Firmenkennung', company_placeholder: 'z. B. ACME', badge: 'Ausweisnummer', password: 'Passwort', button: 'Anmelden',
    demo_credentials: 'Demo-Zugänge', error_fill: 'Bitte alle Felder ausfüllen', welcome: 'Willkommen, {{name}}!',
    auth_error: 'Anmeldung fehlgeschlagen', rights: 'Alle Rechte vorbehalten.',
  },
  roles: {
    administrator: 'Administrator', planner: 'Planer', area_supervisor: 'Bereichsleiter', shift_responsible: 'Schichtleiter',
    operator: 'Maschinenbediener', warehouse_manager: 'Lagerleiter', material_planner: 'Disponent', sales: 'Vertrieb', accounting: 'Buchhaltung',
  },
  sidebar: { logout: 'Abmelden' },
  common: { logout: 'Abmelden' },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
      en: { translation: { ...en, sales: salesEn, shell: shellEn, onboarding: onboardingEn, roles: { ...en.roles, material_planner: 'Material Planner', sales: 'Sales', accounting: 'Accounting' } } },
      ro: { translation: { ...ro, sales: salesEn, shell: shellRo, onboarding: onboardingEn, roles: { ...ro.roles, sales: 'Vânzări', accounting: 'Contabilitate' } } },
    },
    supportedLngs: ['de', 'en', 'ro'],
    nonExplicitSupportedLngs: true,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

export default i18n;
