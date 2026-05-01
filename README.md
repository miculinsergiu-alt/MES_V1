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

### [Mai 2026] — Multi-Level BOM & UX Polish
- **Sistem BOM Ierarhic:** Implementare structură arborescentă recursivă în baza de date și backend.
- **BOM Viewer:** Pagina dedicată de vizualizare cu aliniere automată a coloanelor și navigare inteligentă.
- **Print Industrial:** Layout special pentru fișele de operator, optimizat pentru lizibilitate în producție.
- **Dual Search:** Filtrare simultană după Cod Articol și Denumire în Nomenclator.

### [Aprilie 2026] — Analytics & Infrastructure
- **OEE Dashboard:** Monitorizare în timp real a eficienței utilajelor.
- **Shift System:** Modul de planificare a schimburilor pe echipe și responsabili.
- **Monorepo Structure:** Optimizare pentru deployment (Railway/Cloud).

---
*SmartFactory MES Edition V1.0 — Dezvoltat pentru excelență operațională.*
