# SmartFactory Flow — MES System v1.0

SmartFactory Flow este un sistem de management al producției (Manufacturing Execution System) modern, conceput pentru monitorizarea în timp real a proceselor industriale, gestionarea ierarhică a structurilor de produse (BOM) și planificarea avansată a resurselor.

## 🚀 Tehnologii Core

- **Frontend:** React + Vite, Tailwind CSS v4 (Aesthetic & Responsive)
- **Backend:** Node.js + Express
- **Bază de Date:** SQLite (better-sqlite3) cu arhitectură multi-database
- **Real-time:** Socket.io pentru actualizări instantanee pe shopfloor
- **Animații:** Framer Motion

## ✨ Funcționalități Cheie

- **Gantt Timeline Dual-Layer:** Vizualizarea planificării (PLAN) versus execuția reală (EXEC) în timp real.
- **BOM Multi-Nivel:** Gestionarea rețetelor complexe de fabricație (până la 4 niveluri) cu calcul de cost standard recursiv.
- **OEE & Analytics:** Dashboard-uri pentru performanță, disponibilitate și calitate, cu analiză Pareto pentru cauzele defectelor.
- **Management Schimburi:** Alocarea echipelor pe utilaje și monitorizarea prezenței.
- **Fișe de Fabricație:** Generare automată de documente tehnice optimizate pentru tipărire (Operator Printouts).
- **Gestiune Nomenclator:** Căutare duală avansată (Cod vs Denumire) și controlul marjelor comerciale.

## 🛠️ Instalare și Pornire Rapidă

1. **Instalare dependențe:**
   ```bash
   npm install
   ```

2. **Pornire Backend:**
   ```bash
   cd backend
   node server.js
   ```

3. **Pornire Frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

## 📝 Jurnal de Actualizări (Changelog)

### [Mai 2026] — Advanced Planning (MRP) & Gantt 2.0
- **MRP & Purchase Orders:** Sistem de rezervări automate (Soft Allocation) și recomandări de achiziție bazate pe deficitul de stoc.
- **Finite Capacity Scheduler:** Motor de planificare cu prevenire automată a conflictelor (fără suprapuneri pe utilaje) și aliniere în cascadă.
- **Interactive Gantt 2.0:** Redesign complet cu vizualizare pe 7 zile, navigare Drag-to-Scroll și coloană statică (sticky) pentru utilaje.
- **Logică Consum Strict:** Deducerea materialelor se face exclusiv la prima etapă a rutei, asigurând integritatea stocurilor în ierarhii complexe.
- **UX Enhancements:** Calcul automat `Planned End Date`, ștergere ierarhică Arii/Utilaje și autentificare Material Planner.

### [Mai 2026] — Enterprise WMS & ERP Modules
- **WMS Integration:** Modul complet de management magazii, locații bin-uri și trasabilitate loturi.
- **Recepție Marfă (Goods Receipt):** Flux avansat "multi-package" care permite scanarea și recepționarea fragmentată a loturilor per cutie.
- **ERP Supplier Entry:** Gestiune simplificată a furnizorilor și a timpilor de livrare (Lead Time) direct în fișa articolului.
- **QMS & Quarantine:** Sistem de control al calității pentru blocarea automată a loturilor neconforme în carantină.
- **Motor de Routing Inteligent:** Explozia automată a rutei tehnologice în sub-comenzi (Work Orders).
- **Propagare Cross-Machine:** Re-alinierea automată a întregului flux de producție în caz de delay pe orice stație.
- **Suport Multi-Language:** Implementare completă RO/EN (react-i18next).


### [Aprilie 2026] — Analytics & Infrastructure
- **OEE Dashboard:** Monitorizare în timp real a eficienței utilajelor.
- **Shift System:** Modul de planificare a schimburilor pe echipe și responsabili.
- **Monorepo Structure:** Optimizare pentru deployment (Railway/Cloud).

---
*SmartFactory MES Edition V1.0 — Dezvoltat pentru excelență operațională.*
