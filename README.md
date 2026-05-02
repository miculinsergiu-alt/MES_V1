# SmartFactory Flow — MES System v1.0

[ROMÂNĂ] SmartFactory Flow este un sistem de management al producției (Manufacturing Execution System) modern, conceput pentru monitorizarea în timp real a proceselor industriale, gestionarea ierarhică a structurilor de produse (BOM) și planificarea avansată a resurselor.

[ENGLISH] SmartFactory Flow is a modern Manufacturing Execution System (MES) designed for real-time monitoring of industrial processes, hierarchical Bill of Materials (BOM) management, and advanced resource planning.

## 🚀 Tehnologii Core / Core Technologies

- **Frontend:** React + Vite, Tailwind CSS v4 (Aesthetic & Responsive)
- **Backend:** Node.js + Express
- **Database:** SQLite (better-sqlite3) with multi-database architecture
- **Real-time:** Socket.io for instant shopfloor updates
- **Animations:** Framer Motion

## ✨ Funcționalități Cheie / Key Features

- **Gantt Timeline 2.0:** Dual-layer visualization (PLAN vs EXEC) with 7-day extended view, drag-to-scroll navigation, and sticky machine labels.
- **Finite Capacity Scheduler:** Cascade planning engine that prevents machine overlaps and auto-calculates production timing.
- **Advanced MRP:** Soft material allocation during planning and automatic Purchase Order (PO) recommendations for stock deficits.
- **Multi-Level BOM:** Complex recipe management (up to 4 levels) with recursive standard cost roll-up.
- **OEE & Analytics:** Real-time dashboards for Performance, Availability, and Quality, with Pareto analysis for downtime causes.
- **Digital Shopfloor:** Paperless technical documentation (SOPs), technical drawings, and WMS lot scanning for full traceability.
- **HR & Skill Matrix:** Operator skill management and automated shift allocation.

## 🛠️ Instalare și Pornire / Installation & Startup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start Backend:**
   ```bash
   cd backend
   node server.js
   ```

3. **Start Frontend:**
   ```bash
   cd frontend
   npm run dev
   ```

## 📝 Jurnal de Actualizări / Changelog

### [May 2026] — Advanced Planning (MRP) & Gantt 2.0
- **MRP & Purchase Orders:** Automated reservation system (Soft Allocation) and PO recommendations based on inventory deficit.
- **Finite Capacity Scheduler:** Conflict-prevention scheduling engine with automatic cascading for multi-step routes.
- **Interactive Gantt 2.0:** Redesigned 7-day timeline with fluid drag navigation and persistent machine headers.
- **Strict Consumption Logic:** Material deduction occurs exclusively at the first routing step to ensure data integrity in complex hierarchies.
- **UX Enhancements:** Automated `Planned End Date` calculation, hierarchical deletion for Areas/Machines, and Material Planner login fix.

### [May 2026] — Enterprise WMS & ERP Modules
- **WMS Integration:** Complete warehouse management with bin locations and full lot traceability.
- **Goods Receipt:** Advanced "multi-package" workflow allowing fragmented lot reception per box.
- **ERP Supplier Entry:** Simplified supplier management and Lead Time tracking directly in the item master.
- **QMS & Quarantine:** Quality control system for automated blocking of non-compliant lots.
- **Smart Routing Engine:** Automatic explosion of manufacturing routes into sequential Work Orders.
- **Multi-Language Support:** Full RO/EN localization using `react-i18next`.

### [April 2026] — Analytics & Infrastructure
- **OEE Dashboard:** Real-time Equipment Effectiveness monitoring.
- **Shift System:** Team planning and shift responsible assignment module.
- **Monorepo Structure:** Deployment optimization for PaaS (Render/Railway).

---
*SmartFactory MES Edition V1.0 — Developed for operational excellence.*
