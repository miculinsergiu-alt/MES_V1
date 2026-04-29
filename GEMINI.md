# SmartFactory MES - Status Contextual Proiect

Acest document servește ca memorie pe termen lung pentru Gemini CLI în cadrul acestui proiect (V1).

## Tehnologii Core
- **Backend:** Node.js, Express, SQLite (better-sqlite3).
- **Frontend:** React, Vite, Tailwind CSS v4 (experimental).
- **Comunicare:** Socket.io pentru actualizări live.

## Reguli de Arhitectură și Logică Implementată
1. **Gantt Dual-Layer (Plan vs Exec):**
   - Fiecare rând de utilaj are două straturi: `PLAN` (sus, gri discret) și `EXEC` (jos, culori solide).
   - Culori Exec: Albastru (`--setup-color`) pentru Setup, Verde (`--working-color`) pentru Producție.
   - Eticheta produsului (`.gantt-block-tag`) este text simplu suprapus pe bara de plan, pentru a evita confuzia cu o a 3-a bară.

2. **Propagarea Delay-ului (Chain Reaction):**
   - Implementată în `backend/routes/orders.js` (`propagateDelay`) și `backend/routes/production.js` (`propagateScheduleShift`).
   - Când o comandă primește un delay de $N$ minute, ora sa de sfârșit crește.
   - **Toate comenzile ulterioare** de pe acel utilaj sunt mutate automat: `new_planned_start = previous_order_planned_end`.

3. **Detectare Automată Întârziere:**
   - În `production.js`, dacă un operator pornește Setup-ul după ora planificată, sistemul înregistrează automat un delay și re-aliniază tot planul de după.

4. **Design Uniform (Excel-Style):**
   - Utilizarea `.table-container` pentru margini și linii clare.
   - Font uniform: Inter (sans-serif) pentru date tehnice, Calistoga (display) pentru titluri mari.
   - Butoane Operator: Mari, colorate tactil pentru utilizare rapidă.

## Ultimele Fix-uri Importante
- **Cale CSS:** Tailwind v4 caută config-ul în `../tailwind.config.js` relativ la `src/index.css`.
- **Update Comandă:** Ruta de PUT din backend permite acum schimbarea `machine_id` (mutarea comenzii între utilaje).
- **Gantt Refresh:** Folosește chei compuse pe rânduri pentru a forța re-randarea la mutarea comenzilor.

## Module Recente Implementate (Sesiunea Curentă)
1. **OEE Dashboard & Pareto Delays:**
   - Calcul real-time (Disponibilitate, Performanță, Calitate) și vizualizare Pareto a motivelor de oprire.
   - Implementat în `backend/routes/oee.js` și `backend/routes/analytics.js`.

2. **Gestiune Schimburi & Trasabilitate Umană:**
   - Tabelă `operator_schedules` pentru planificarea oamenilor pe schimburi și utilaje.
   - Tab nou "Schimburi" în `AdminDashboard.jsx` și afișare Schimb Curent în header-ul Operatorului.

3. **Integrare Mentenanță în Gantt:**
   - Câmp `order_type` (production/maintenance) în tabela `orders`.
   - Vizualizare portocalie hașurată pe Gantt pentru mentenanță, separată de producția standard.

4. **Analiză Abateri de Cost:**
   - Câmp `unit_price` și calcul automat al marjei în `ItemsManager.jsx`.
   - Raport Analytics: **Cost Standard (BOM)** vs **Cost Real (Lot Usage)** pentru control financiar.

5. **Raportare Delay Detaliată:**
   - Dropdown coduri defecte și câmp "Măsuri Corective" în `OperatorDashboard.jsx`.
   - Logica de propagare a delay-ului păstrată, dar îmbogățită cu context decizional.


## Configurare Deployment (Railway / Cloud)
- **Arhitectură Monorepo:** Sistemul folosește `npm workspaces` în fișierul `package.json` de la rădăcină pentru a construi ambele module simultan, ideal pentru medii PaaS.
- **Servire Statică:** Fișierele Vite de frontend (`dist/`) sunt servite direct de backend-ul Express (`server.js`), folosind un singur domeniu în producție și fallback pentru React Router.
- **Probleme NPM Curente Evitate:** Librăriile Vite / Tailwind se țin în `dependencies` (nu `devDependencies`), iar `package-lock.json` este exclus pentru a evita bug-urile `NODE_ENV=production` și lipsa binarelor native Linux în cloud.
- **WebSocket:** Socket.io folosește rută relativă în producție și un proxy în `vite.config.js` pe localhost.

## Jurnal Modificări (Sesiunea 29 Aprilie 2026)
- **Database Migrations:** Adăugat `unit_price`, `order_type`, `delay_reason_id`, `corrective_action` și tabela `operator_schedules`.
- **Shift System:** Backend `shifts.js` + Admin UI pentru planificare săptămânală.
- **Maintenance Integration:** Permite planificarea mentenanței pe Gantt (vizualizare portocalie hașurată).
- **Financial Control:** Trasabilitate costuri BOM vs Real + analiză marjă în nomenclator.
- **Root Cause Analysis:** Pareto Chart pentru motive delay și raportare operator cu măsuri corective.

## Jurnal Modificări (Sesiunea 29 Aprilie 2026 - Update 2)
- **Modernizare Nomenclator:** Refactorizat `ItemsManager.jsx` folosind `ModalWrapper` și componente UI unificate. Reparat crash-ul la editare prin inițializarea corectă a rutelor.
- **Team-Based Shifts (Admin/Supervisor):** Implementat `ShiftDefinitionModal`. Schimburile au acum un Responsabil dedicat și o listă fixă de operatori (echipă). Buton redenumit în "+ Crează schimb nou".
- **Shift Responsible Dashboard:** 
  - Logica de filtrare: Responsabilul vede implicit doar operatorii din echipa sa.
  - Funcționalitate **Overtime**: Buton dedicat pentru adăugarea de operatori din alte schimburi în pool-ul curent de alocare.
- **Arhitectură UI:** Migrare completă către `framer-motion` pentru animații de tranziție între tab-uri și deschideri de modale.

## Cum să pornești rapid o sesiune nouă
La începutul fiecărei conversații, poți folosi următoarea instrucțiune:
> "Citește fișierul GEMINI.md și pune-te la curent cu statusul proiectului."
