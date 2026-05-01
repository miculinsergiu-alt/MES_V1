import { useTranslation } from 'react-i18next';
import { Button } from './ui/Button';
import { Globe } from 'lucide-react';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'ro' ? 'en' : 'ro';
    i18n.changeLanguage(newLang);
  };

  return (
    <Button 
      variant="ghost" 
      size="sm" 
      onClick={toggleLanguage}
      className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
    >
      <Globe size={14} />
      {i18n.language === 'ro' ? 'RO' : 'EN'}
    </Button>
  );
}
