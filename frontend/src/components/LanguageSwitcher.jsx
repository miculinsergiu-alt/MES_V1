import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { Globe } from 'lucide-react';

const LANGUAGES = ['de', 'en', 'ro'];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = LANGUAGES.find((l) => i18n.language?.startsWith(l)) || 'en';

  const toggleLanguage = () => {
    const next = LANGUAGES[(LANGUAGES.indexOf(current) + 1) % LANGUAGES.length];
    i18n.changeLanguage(next);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleLanguage}
      aria-label="Language"
      className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
    >
      <Globe size={14} />
      {current.toUpperCase()}
    </Button>
  );
}
