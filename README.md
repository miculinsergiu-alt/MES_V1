# NOVA — Manufacturing ERP

NOVA is a web-based ERP for small and medium manufacturing companies: production planning (Gantt, finite-capacity scheduling), multi-level BOMs, MRP, purchasing and goods receipt, warehouses with lot traceability, quality/quarantine, OEE, maintenance and shift management.

It runs as one hosted application serving many customer companies, with each company's data strictly separated.

## Tech stack

- **Frontend:** React + Vite, Tailwind CSS v4, Framer Motion, react-i18next
- **Backend:** Node.js 20+, Express 5, zod validation
- **Database:** PostgreSQL 16 (embedded PostgreSQL via PGlite for local development and tests — no install needed)
- **Real-time:** Socket.io (authenticated, per company)

## Getting started (local development)

```bash
npm install          # once, in the project root
start.bat            # Windows: starts backend + frontend and opens the browser
```

Or manually: `npm run dev --workspace=backend` and `npm run dev --workspace=frontend`, then open http://localhost:5173.

On first start with an empty database, a demo company is created:

| Company code | Badge numbers | Password |
|---|---|---|
| `DEMO` | `ADMIN001`, `PLN001`, `SPV001`, `SHR001`, `OPR001`, `WHM001`, `MAT001` | `demo1234` |

Local data lives in `backend/data/` (ignored by git). Delete that folder to start fresh.

## Tests

```bash
npm test             # API tests against an in-memory PostgreSQL
```

The tests cover login and roles, separation between companies, validation, the purchase → stock → BOM → MRP → production flow, scheduling and delays, and real-time events.

## Administration scripts (run in `backend/`)

| Command | Purpose |
|---|---|
| `NOVA_ADMIN_PASSWORD=... npm run create-company -- --code ACME --name "Acme GmbH"` | Create a customer company and its first administrator |
| `npm run seed:demo` | Create the `DEMO` company (never on a production database with real customers) |
| `npm run export-company -- --code ACME` | Export one company's data as JSON (off-site backup, GDPR data requests). Password hashes are never exported. |
| `npm run import:sqlite -- --file db/smartfactory.db --code ACME --name "Acme GmbH"` | One-time import of an old NOVA SQLite database into a fresh database |
| `npm run validate:einvoices -- <files>` | Check e-invoices with the official KoSIT validator and Mustang (tools folder: see the script) |
| `npm run migrate` | Apply database migrations (also happens automatically on start) |

All scripts use `DATABASE_URL` when set, otherwise the local embedded database.

## Deployment (Render, Frankfurt)

`render.yaml` is a Render Blueprint: a web service plus a managed PostgreSQL database, both in the **Frankfurt (EU)** region.

1. In Render: **New → Blueprint**, select this repository.
2. Render creates the database, generates `JWT_SECRET` and connects everything.
3. After the first deploy, open the service's **Shell** and create the first customer company with `create-company` (see above).
4. Sign Render's Data Processing Addendum (DPA/AVV) before storing customer data.

**Backups:** paid Render PostgreSQL plans include automatic daily backups with point-in-time recovery. For an extra off-site copy, run `export-company` regularly or `pg_dump` against the external database URL.

Required settings in production (see `backend/.env.example`): `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` (≥ 32 characters). The app refuses to start without them.

## Architecture notes

- **Company separation:** every business table has a `company_id`. PostgreSQL row-level security only shows rows of the logged-in user's company, and composite foreign keys stop any record from referencing another company's data. The app refuses to start if row-level security is not enforced.
- **One transaction per request:** every API request runs in a single database transaction. If anything fails, nothing is saved. Real-time events are sent only after the commit.
- **Audit log:** every change (POST/PUT/DELETE) is logged with user, time and request data (passwords redacted).
- **Database changes:** add a new numbered file to `backend/db/migrations/`. Never edit a migration that has already been deployed.
- **Times:** planning times are stored as local wall-clock time of the company's time zone (default `Europe/Berlin`).
- **API errors** have the form `{ "error": "readable message", "code": "MACHINE_CODE" }`, with `details` for validation errors.

## Changelog

### [November 2026] — Phase 3: Stock, traceability, costing & reports
- All stock movements go through one stock service: lots first-in-first-out, quarantined lots skipped, unit cost on every movement.
- Finished goods are booked into stock: one production lot per order (`FA-<order>`), valued at actual cost per good part. Deliveries take goods from lots.
- Negative stock rule per company: allow, warn, or block (the booking is refused).
- Moving average purchase cost from goods receipts.
- Batch traceability (Chargenrückverfolgung): from a supplier lot forward to production orders, production lots and customer deliveries, and backward to the material lots and suppliers. Search by lot, item, customer or delivery note.
- Nachkalkulation: planned vs. actual material, machine and labour cost per production order, with machine hourly rates and a company labour rate; margin per order. Planned times are used (and marked) where no times were reported.
- Reports with Excel export: sales & gross margin (per customer or item), stock value, on-time delivery; actual costing list.
- Users can have several roles; access is the union of all of them.

### [November 2026] — Phase 2: Usability
- One app shell for all roles with role-based navigation, global search (Ctrl+K) and a dashboard per role.
- Import of items, customers, suppliers and stock from Excel/CSV (German number and date formats), with a preview before saving.
- Self-service sign-up (optional invite code) and a setup wizard for new companies, with optional sample data.
- German as the main language across all screens; English and Romanian available.
- Screens usable on phones and tablets.

### [November 2026] — Phase 1: Sales, invoicing & e-invoices (Germany)
- Customers (VIES VAT check, tax treatment from country and VAT ID), company settings, gap-free number ranges.
- Quote → order confirmation → delivery note → invoice, partial deliveries, make-to-order production orders.
- GoBD: issued documents locked by the database, corrections only via Rechnungskorrektur, write-once archive with SHA-256.
- E-invoices: ZUGFeRD (Factur-X EN 16931, PDF/A-3) and XRechnung 3.0, validated with the official KoSIT validator and Mustang for domestic, intra-EU, export, credit note and § 19 cases.
- Receiving e-invoices: ZUGFeRD PDF and XRechnung (CII and UBL), plausibility checks, duplicate detection, supplier and purchase-order matching, approval workflow, original archived unchanged.
- Payments with Skonto, open items, three reminder levels, DATEV Buchungsstapel export (SKR03/SKR04).
- Sales & invoicing screens in German and English; roles Sales and Accounting.

### [November 2026] — Phase 0: Foundation
- PostgreSQL instead of SQLite, with migrations; embedded PostgreSQL for development.
- Multiple companies on one installation with database-enforced separation; login with company code.
- Login required on every API route and real-time connection; no default secrets; demo logins only shown in development.
- Input validation on all routes, consistent error format, one transaction per request, audit log without passwords.
- 59 automated tests.
- Render Blueprint for Frankfurt with managed PostgreSQL; company data export.
- Supplier VAT ID with live EU VIES check (with timeout and correct handling of VIES outages).

### [May 2026] — Advanced Planning (MRP) & Gantt 2.0
- MRP with soft allocation and purchase recommendations, finite-capacity scheduler, interactive 7-day Gantt.

### [May 2026] — Enterprise WMS & ERP Modules
- Warehouses with bin locations and lot traceability, multi-package goods receipt, suppliers, quarantine, routing engine, RO/EN localisation.

### [April 2026] — Analytics & Infrastructure
- OEE dashboard, shift system.
