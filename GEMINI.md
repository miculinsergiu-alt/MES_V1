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
1. **OEE Dashboard (Overall Equipment Effectiveness):**
   - Calcul real-time (Disponibilitate, Performanță, Calitate) pe baza `operator_actions` și `production_results`.
   - Implementat în `backend/routes/oee.js` (ruta `/api/oee`) și vizualizat în `frontend/src/pages/analytics/OEEPage.jsx` folosind grafice Recharts.

2. **Scanare Lot WMS (Trasabilitate):**
   - Operatorii trebuie să introducă/scaneze codul lotului materialelor în `OperatorDashboard.jsx` folosind `LotScanModal` la pornirea Setup-ului.
   - Baza de date conține acum tabelele `inventory_lots` și `order_material_lots` pentru trasabilitate completă a materiei prime.

3. **Digitalizare Instrucțiuni (SOP-uri):**
   - Butoanele *SOP* și *Desen* apar dinamic pe `OperatorDashboard` dacă `itemDetails` are `sop_url` sau `drawing_url` completate. Documentele se deschid în tab nou.

4. **HR & Skill Matrix:**
   - `SkillModal` din `AdminDashboard.jsx` permite nu doar asignarea mașinilor pe operatori, ci și stabilirea nivelului de competență (`skill_level`: trainee/independent/expert) și `expiration_date` pentru monitorizare training.

## Cum să pornești rapid o sesiune nouă
La începutul fiecărei conversații, poți folosi următoarea instrucțiune:
> "Citește fișierul GEMINI.md și pune-te la curent cu statusul proiectului."
