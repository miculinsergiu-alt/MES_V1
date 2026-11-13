import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/** Horizontal section tabs inside a page (links, so sections keep their own address). */
export default function SubNav({ items }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const activeIndex = items.reduce((best, item, i) => (
    (pathname === item.path || pathname.startsWith(`${item.path}/`)) && (best < 0 || item.path.length > items[best].path.length) ? i : best
  ), -1);
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1" aria-label="Sections">
      {items.map((item, i) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${i === (activeIndex < 0 ? 0 : activeIndex) ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {item.icon}
          {t(item.labelKey || item.label)}
        </NavLink>
      ))}
    </nav>
  );
}
