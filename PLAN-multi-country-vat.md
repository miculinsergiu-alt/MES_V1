# Plan: invoicing for UK + all EU countries (started 2026-11-20 23:15)

Branch: `feat/multi-country-vat`. Baseline: backend `npm test` = 240/240 pass.
Asked for by the user on Telegram: "Facturarea vreau sa o faci pt uk, dar și țările din UE".

## Decisions
- Seller country = `companies.country` (it already exists, default DE). Currency = `companies.currency` (EUR/GBP).
- VAT rates: table in lib/vat.js (EU27 + GB). Rates come from secondary sources (Nov 2026) and must be checked by the customer.
  The server accepts any rate from 0 to 30 % (a DB CHECK replaces the old IN (0, 7, 19)), and the UI suggests the country's rates.
- Tax treatment, seen from the seller:
  - same country -> domestic;
  - EU seller with an EU buyer that has a VAT ID -> intra_eu (K, 0 %);
  - EU buyer without a VAT ID -> domestic (distance sale under the €10k OSS threshold; noted);
  - anything else -> export (G, 0 %);
  - GB seller -> domestic only for GB, otherwise export (zero-rated).
- Domestic line with 0 % -> category Z (was 19 % before; check the DE tests).
- Document language: `sales_documents.language` ('de' | 'en'), taken from `customers.language`. The customer default comes from the country (DE/AT/CH/LI -> de, otherwise en).
- Legal notes: DE seller keeps the current German UStG texts. Other EU sellers get the VAT Directive (Art. 138 / 146). GB gets the VAT Act 1994. Each note exists in DE and EN.
- VAT ID: accept GB (GB + 9 or 12 digits, GBGD/GBHA + 3) and XI, in addition to the EU.
- Currency on documents = the company's currency; the PDF formats amounts by currency + language.

## Steps
1. [x] lib/vat.js: COUNTRIES (rates, EU flag, language), defaultTaxTreatment(customerCountry, vatId, sellerCountry), lineTax (Z for 0), taxNote(treatment, sellerCountry, lang), GB VAT ID. Unit tests.
2. [x] migration 018: items tax_rate CHECK 0..30; customers.language; sales_documents.language; customers.tax_treatment stays.
3. [x] routes: items/sales/importer validation 0..30; customers + importer use the seller country; settings country/currency validation (+ GB VAT ID).
4. [x] services/sales.js: currency + language on the document, taxNote, invoiceProblems text, intro text for credit notes in EN.
5. [x] services/pdf.js: DE/EN labels, currency formatting, EN dunning letters.
6. [x] einvoice.js: currency + country already come from the doc/company; check VATEX for GB.
7. [x] frontend: Settings (country, currency), customer form (language), DocumentEditor tax-rate dropdown, eur() by currency (done).
8. [x] tests: new ones for GB / AT / FR / IE, the whole suite green; update the UK demo (20 % VAT).
9. [x] Report to the user. No commit or deploy without their OK.

## Status 2026-11-21 00:00
All steps done. Commit 73d68b9 pushed to origin/feat/multi-country-vat (NOT merged into main, NOT deployed).
Open points:
- Merge + deploy to Render only with the user's yes.
- EU distance sales (B2C) above the €10k OSS threshold are not supported (the seller's rate is used).
- VAT rates in lib/vat.js come from secondary sources (Nov 2026); check them before a real customer.
- DATEV export stays German only.
- Local demo: company NOVAGB (DEMOUK/UKDEMO/NOVAUK are obsolete leftovers in the local PGlite).
