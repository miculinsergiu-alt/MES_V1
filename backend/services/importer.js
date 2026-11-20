/**
 * Excel / CSV import for master data and opening stock.
 *
 * Flow: upload → preview (columns recognised automatically, every row
 * validated) → commit. The commit runs in one transaction: either all rows are
 * imported or none.
 *
 * Supports .xlsx/.xls/.ods and .csv (comma or semicolon, UTF-8 or
 * Windows-1252 as exported by German Excel); German number formats
 * ("1.234,56") and German column names.
 */
const XLSX = require('@e965/xlsx');
const db = require('../db');
const numbering = require('../lib/numbering');
const { normalizeVatId, defaultTaxTreatment, isValidRate, standardRate, vatInfo } = require('../lib/vat');
const { badRequest } = require('../lib/errors');

const MAX_ROWS = 5000;

// ─── Value parsing ──────────────────────────────────────────────────────────

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');

function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v).trim().replace(/\s|€|EUR|%/gi, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // German
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); // English thousands
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); // 31.12.2026
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return 'invalid';
}

const COUNTRY_NAMES = {
  deutschland: 'DE', germany: 'DE', germania: 'DE', osterreich: 'AT', oesterreich: 'AT', austria: 'AT', schweiz: 'CH', switzerland: 'CH', elvetia: 'CH',
  frankreich: 'FR', france: 'FR', franta: 'FR', italien: 'IT', italy: 'IT', italia: 'IT', niederlande: 'NL', netherlands: 'NL', olanda: 'NL',
  polen: 'PL', poland: 'PL', polonia: 'PL', rumanien: 'RO', romania: 'RO', belgien: 'BE', belgium: 'BE', belgia: 'BE', tschechien: 'CZ',
  czechia: 'CZ', spanien: 'ES', spain: 'ES', spania: 'ES', danemark: 'DK', denmark: 'DK', luxemburg: 'LU', luxembourg: 'LU', ungarn: 'HU',
  hungary: 'HU', ungaria: 'HU', schweden: 'SE', sweden: 'SE', grossbritannien: 'GB', vereinigteskonigreich: 'GB', unitedkingdom: 'GB', uk: 'GB',
  usa: 'US', vereinigtestaaten: 'US', unitedstates: 'US',
};

const ITEM_TYPES = {
  rawmaterial: 'raw_material', rohstoff: 'raw_material', rohmaterial: 'raw_material', material: 'raw_material', kaufteil: 'raw_material', materieprima: 'raw_material',
  semifinished: 'semi_finished', halbfabrikat: 'semi_finished', halbzeug: 'semi_finished', baugruppe: 'semi_finished', semifabricat: 'semi_finished',
  finishedgood: 'finished_good', fertigprodukt: 'finished_good', fertigerzeugnis: 'finished_good', fertigteil: 'finished_good', produsfinit: 'finished_good', produkt: 'finished_good',
};

// Field types: text(max), number(min?), int, date, enum handled in convert().
const FIELDS = {
  items: [
    { key: 'item_code', type: 'text', max: 100, required: true, names: ['Artikelnummer', 'Artikel-Nr', 'Art.-Nr.', 'ArtNr', 'Item code', 'SKU', 'Code', 'Cod articol', 'Cod'] },
    { key: 'name', type: 'text', max: 300, required: true, names: ['Bezeichnung', 'Artikelbezeichnung', 'Name', 'Description', 'Denumire'] },
    { key: 'type', type: 'itemType', names: ['Typ', 'Artikeltyp', 'Art', 'Type', 'Tip'] },
    { key: 'uom', type: 'text', max: 20, names: ['Einheit', 'Mengeneinheit', 'ME', 'Unit', 'UoM', 'UM'] },
    { key: 'unit_price', type: 'number', min: 0, names: ['Verkaufspreis', 'VK-Preis', 'VK', 'Preis', 'Sales price', 'Price', 'Pret vanzare', 'Pret'] },
    { key: 'acquisition_cost', type: 'number', min: 0, names: ['Einkaufspreis', 'EK-Preis', 'EK', 'Purchase price', 'Cost', 'Pret achizitie'] },
    { key: 'production_cost', type: 'number', min: 0, names: ['Herstellkosten', 'Production cost', 'Cost productie'] },
    { key: 'tax_rate', type: 'taxRate', names: ['MwSt', 'MwSt.-Satz', 'USt', 'Steuersatz', 'VAT', 'VAT rate', 'TVA'] },
    { key: 'lead_time_days', type: 'int', min: 0, names: ['Lieferzeit', 'Lieferzeit (Tage)', 'Lead time', 'Termen livrare'] },
    { key: 'supplier_name', type: 'text', max: 300, names: ['Lieferant', 'Supplier', 'Furnizor'] },
  ],
  customers: [
    { key: 'customer_number', type: 'text', max: 30, names: ['Kundennummer', 'Kunden-Nr', 'Kd-Nr', 'KdNr', 'Customer number', 'Customer no', 'Nr client'] },
    { key: 'name', type: 'text', max: 300, required: true, names: ['Firma', 'Name', 'Kunde', 'Firmenname', 'Company', 'Customer', 'Client', 'Denumire'] },
    { key: 'name2', type: 'text', max: 300, names: ['Name 2', 'Zusatz', 'Adresszusatz', 'Address line 2'] },
    { key: 'street', type: 'text', max: 300, names: ['Straße', 'Strasse', 'Str.', 'Anschrift', 'Street', 'Address', 'Strada', 'Adresa'] },
    { key: 'postal_code', type: 'text', max: 20, names: ['PLZ', 'Postleitzahl', 'Postal code', 'ZIP', 'Cod postal'] },
    { key: 'city', type: 'text', max: 200, names: ['Ort', 'Stadt', 'City', 'Oras', 'Localitate'] },
    { key: 'country', type: 'country', names: ['Land', 'Country', 'Tara'] },
    { key: 'vat_id', type: 'vatId', names: ['USt-IdNr', 'USt-ID', 'UStIdNr', 'VAT ID', 'VAT number', 'CUI', 'Cod TVA'] },
    { key: 'email', type: 'email', names: ['E-Mail', 'Email', 'Mail'] },
    { key: 'invoice_email', type: 'email', names: ['Rechnungs-E-Mail', 'Rechnungsmail', 'Invoice email'] },
    { key: 'phone', type: 'text', max: 100, names: ['Telefon', 'Tel', 'Phone', 'Telefonnummer'] },
    { key: 'contact_person', type: 'text', max: 200, names: ['Ansprechpartner', 'Kontakt', 'Contact', 'Contact person', 'Persoana de contact'] },
    { key: 'payment_terms_days', type: 'int', min: 0, names: ['Zahlungsziel', 'Zahlungsziel (Tage)', 'Payment terms', 'Termen plata'] },
    { key: 'leitweg_id', type: 'text', max: 50, names: ['Leitweg-ID', 'Leitweg ID'] },
    { key: 'notes', type: 'text', max: 5000, names: ['Notiz', 'Bemerkung', 'Notes', 'Observatii'] },
  ],
  suppliers: [
    { key: 'name', type: 'text', max: 300, required: true, names: ['Firma', 'Name', 'Lieferant', 'Supplier', 'Furnizor', 'Denumire'] },
    { key: 'contact_person', type: 'text', max: 200, names: ['Ansprechpartner', 'Kontakt', 'Contact', 'Contact person'] },
    { key: 'email', type: 'email', names: ['E-Mail', 'Email', 'Mail'] },
    { key: 'phone', type: 'text', max: 100, names: ['Telefon', 'Tel', 'Phone'] },
    { key: 'address', type: 'text', max: 1000, names: ['Adresse', 'Anschrift', 'Address', 'Adresa'] },
    { key: 'vat_number', type: 'vatId', names: ['USt-IdNr', 'USt-ID', 'VAT ID', 'VAT number', 'CUI', 'Cod TVA'] },
  ],
  stock: [
    { key: 'item_code', type: 'text', max: 100, required: true, names: ['Artikelnummer', 'Artikel-Nr', 'Art.-Nr.', 'Item code', 'SKU', 'Code', 'Cod articol'] },
    { key: 'quantity', type: 'number', min: 0, required: true, names: ['Bestand', 'Menge', 'Anzahl', 'Quantity', 'Qty', 'Stock', 'Cantitate'] },
    { key: 'lot_number', type: 'text', max: 200, names: ['Charge', 'Chargennummer', 'Los', 'Lot', 'Lot number', 'Batch'] },
    { key: 'location', type: 'text', max: 200, names: ['Lagerplatz', 'Platz', 'Location', 'Locatie'] },
    { key: 'expiration_date', type: 'date', names: ['MHD', 'Verfallsdatum', 'Haltbar bis', 'Expiry date', 'Data expirare'] },
  ],
  boms: [
    { key: 'parent_item_code', type: 'text', max: 100, required: true, names: ['Baugruppe', 'Übergeordneter Artikel', 'Stücklistenartikel', 'Parent item', 'Parent', 'Produs'] },
    { key: 'component_item_code', type: 'text', max: 100, required: true, names: ['Komponente', 'Bauteil', 'Position Artikel', 'Component', 'Component item', 'Componenta'] },
    { key: 'quantity', type: 'number', min: 0, required: true, names: ['Menge', 'Anzahl', 'Quantity', 'Qty', 'Cantitate'] },
    { key: 'position_code', type: 'text', max: 50, names: ['Position', 'Pos', 'Pos.', 'Positionsnummer'] },
  ],
};

const EXAMPLES = {
  items: { item_code: 'WB-100', name: 'Winkelblech 100 x 50 mm', type: 'Fertigprodukt', uom: 'Stk', unit_price: '12,50', acquisition_cost: '', production_cost: '4,20', tax_rate: 19, lead_time_days: '', supplier_name: '' },
  customers: { customer_number: '', name: 'Muster Maschinenbau GmbH', name2: 'Einkauf', street: 'Hauptstraße 1', postal_code: '10115', city: 'Berlin', country: 'DE', vat_id: 'DE123456789', email: 'einkauf@muster.de', invoice_email: '', phone: '+49 30 123456', contact_person: 'Frau Muster', payment_terms_days: 14, leitweg_id: '', notes: '' },
  suppliers: { name: 'Stahlhandel Nord GmbH', contact_person: 'Herr Nord', email: 'verkauf@stahl-nord.de', phone: '+49 40 1234', address: 'Hafenstraße 9, 20457 Hamburg', vat_number: 'DE811111111' },
  stock: { item_code: 'STAHL-S235', quantity: '1.250,5', lot_number: 'CH-2026-001', location: 'A-01-03', expiration_date: '' },
  boms: { parent_item_code: 'WB-100', component_item_code: 'STAHL-S235', quantity: '0,85', position_code: '10' },
};

// ─── Reading files ──────────────────────────────────────────────────────────

function readRows(buffer, filename) {
  const isText = /\.(csv|txt)$/i.test(filename) || !/^(PK|\xD0\xCF)/.test(buffer.subarray(0, 2).toString('latin1'));
  const opts = { type: 'buffer', cellDates: true, raw: false };
  if (isText) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { text = buffer.toString('latin1'); }
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
    const wb = XLSX.read(text, { type: 'string', FS: sep, raw: true, cellDates: false });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true, rawNumbers: false });
  }
  let wb;
  try { wb = XLSX.read(buffer, opts); } catch (e) { throw badRequest(`The file could not be read: ${e.message}`); }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw badRequest('The file has no worksheet');
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
}

/** Maps file columns to fields by name (German/English/Romanian, case/umlaut-insensitive). */
function autoMapping(type, headers) {
  const mapping = {};
  for (const f of FIELDS[type]) {
    const candidates = [f.key, ...f.names].map(norm);
    const header = headers.find((h) => candidates.includes(norm(h)));
    if (header) mapping[f.key] = header;
  }
  return mapping;
}

function convert(field, raw, ctx = {}) {
  const empty = raw === null || raw === undefined || String(raw).trim() === '';
  if (empty) return { value: null, error: field.required ? 'is required' : null };
  switch (field.type) {
    case 'text': {
      const s = String(raw instanceof Date ? parseDate(raw) : raw).trim();
      return s.length > field.max ? { error: `is longer than ${field.max} characters` } : { value: s };
    }
    case 'number': case 'int': {
      const n = parseNumber(raw);
      if (Number.isNaN(n)) return { error: `"${raw}" is not a number` };
      if (field.type === 'int' && !Number.isInteger(n)) return { error: `"${raw}" must be a whole number` };
      if (field.min !== undefined && n < field.min) return { error: `must not be below ${field.min}` };
      return { value: n };
    }
    case 'date': {
      const d = parseDate(raw);
      return d === 'invalid' ? { error: `"${raw}" is not a date (DD.MM.YYYY)` } : { value: d };
    }
    case 'email': {
      const s = String(raw).trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { value: s } : { error: `"${s}" is not an e-mail address` };
    }
    case 'vatId': {
      const v = normalizeVatId(raw);
      return v ? { value: v } : { error: `"${raw}" is not a valid EU VAT ID` };
    }
    case 'country': {
      const s = String(raw).trim();
      if (/^[A-Za-z]{2}$/.test(s)) return { value: s.toUpperCase() };
      const code = COUNTRY_NAMES[norm(s)];
      return code ? { value: code } : { error: `unknown country "${s}" (use a 2-letter code like DE)` };
    }
    case 'itemType': {
      const k = ITEM_TYPES[norm(raw)] || (['raw_material', 'semi_finished', 'finished_good'].includes(String(raw).trim()) ? String(raw).trim() : null);
      return k ? { value: k } : { error: `unknown type "${raw}" (Rohstoff, Halbfabrikat or Fertigprodukt)` };
    }
    case 'taxRate': {
      // Imported rates must be ones of the seller's country (catches typos and outdated rates like 16 %).
      const n = parseNumber(raw);
      const allowed = ctx.rates || [0, 19, 7];
      return isValidRate(n) && allowed.includes(n) ? { value: n } : { error: `VAT rate "${raw}" must be one of ${allowed.join(', ')}` };
    }
    default: return { value: raw };
  }
}

/** Parses and validates a file. Returns everything the preview screen needs. */
async function preview(type, buffer, filename, mappingOverride) {
  if (!FIELDS[type]) throw badRequest(`Unknown import type ${type}`);
  const raw = readRows(buffer, filename);
  if (!raw.length) throw badRequest('The file contains no data rows');
  if (raw.length > MAX_ROWS) throw badRequest(`At most ${MAX_ROWS} rows per import`);
  const headers = Object.keys(raw[0]);
  const mapping = { ...autoMapping(type, headers), ...(mappingOverride || {}) };
  // '__none__' (or an unknown column) = field deliberately not used
  for (const [k, h] of Object.entries(mapping)) if (h === '__none__' || !headers.includes(h)) delete mapping[k];
  const missing = FIELDS[type].filter((f) => f.required && !mapping[f.key]).map((f) => f.key);
  const seller = (await db.get('SELECT country FROM companies WHERE id = nova_company_id()'))?.country;
  const ctx = { rates: [0, ...vatInfo(seller).rates] };

  const rows = raw.map((r, i) => {
    const data = {};
    const errors = [];
    for (const f of FIELDS[type]) {
      if (!mapping[f.key]) continue;
      const { value, error } = convert(f, r[mapping[f.key]], ctx);
      if (error) errors.push(`${f.key}: ${error}`); else if (value !== null) data[f.key] = value;
    }
    return { row: i + 2, data, errors }; // +2: header row and 1-based numbering as in Excel
  });

  await crossChecks(type, rows);
  // Rows that are completely empty are ignored.
  const used = rows.filter((r) => Object.keys(r.data).length || r.errors.some((e) => !e.endsWith('is required')));
  return {
    type,
    headers,
    mapping,
    missing_columns: missing,
    fields: FIELDS[type].map((f) => ({ key: f.key, required: !!f.required })),
    rows: used,
    valid_count: used.filter((r) => !r.errors.length).length,
    error_count: used.filter((r) => r.errors.length).length,
  };
}

/** Checks that need the database or several rows (duplicates, references). */
async function crossChecks(type, rows) {
  const seen = new Map();
  const dupKey = { items: 'item_code', customers: 'customer_number', suppliers: 'name' }[type];
  if (dupKey) {
    for (const r of rows) {
      const k = r.data[dupKey] && String(r.data[dupKey]).toLowerCase();
      if (!k) continue;
      if (seen.has(k)) r.errors.push(`${dupKey}: "${r.data[dupKey]}" appears more than once in the file (row ${seen.get(k)})`);
      else seen.set(k, r.row);
    }
  }
  if (type === 'stock' || type === 'boms') {
    const codes = new Set(rows.flatMap((r) => [r.data.item_code, r.data.parent_item_code, r.data.component_item_code]).filter(Boolean));
    const found = new Map((await db.all('SELECT id, item_code FROM items WHERE item_code = ANY(?::text[])', [[...codes]])).map((i) => [i.item_code, i.id]));
    for (const r of rows) {
      for (const k of ['item_code', 'parent_item_code', 'component_item_code']) {
        if (r.data[k] && !found.has(r.data[k])) r.errors.push(`${k}: item "${r.data[k]}" does not exist (import the items first)`);
      }
      if (type === 'boms' && r.data.parent_item_code && r.data.parent_item_code === r.data.component_item_code) {
        r.errors.push('component_item_code: an item cannot be a component of itself');
      }
    }
  }
  if (type === 'stock') {
    const keys = new Map();
    for (const r of rows) {
      const k = `${r.data.item_code}|${r.data.lot_number || ''}`;
      if (keys.has(k)) r.errors.push(`item_code: "${r.data.item_code}"${r.data.lot_number ? ` lot ${r.data.lot_number}` : ''} appears more than once (row ${keys.get(k)})`);
      else keys.set(k, r.row);
    }
  }
}

// ─── Commit ─────────────────────────────────────────────────────────────────

async function commit(type, buffer, filename, mappingOverride, userId) {
  const p = await preview(type, buffer, filename, mappingOverride);
  if (p.missing_columns.length) throw badRequest(`Required columns are missing: ${p.missing_columns.join(', ')}`);
  if (p.error_count) throw badRequest(`${p.error_count} row(s) have errors. Fix them and try again — nothing was imported.`);
  const result = { created: 0, updated: 0 };
  const rows = p.rows.map((r) => r.data);

  if (type === 'items') {
    const defaultRate = standardRate((await db.get('SELECT country FROM companies WHERE id = nova_company_id()'))?.country);
    for (const d of rows) {
      const r = await db.get(`
        INSERT INTO items (item_code, name, type, uom, unit_price, acquisition_cost, production_cost, tax_rate, lead_time_days, supplier_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (company_id, item_code) DO UPDATE SET
          name = EXCLUDED.name,
          type = COALESCE(?, items.type), uom = COALESCE(?, items.uom), unit_price = COALESCE(?, items.unit_price),
          acquisition_cost = COALESCE(?, items.acquisition_cost), production_cost = COALESCE(?, items.production_cost),
          tax_rate = COALESCE(?, items.tax_rate), lead_time_days = COALESCE(?, items.lead_time_days),
          supplier_name = COALESCE(?, items.supplier_name), active = 1
        RETURNING (xmax = 0) AS inserted`,
      [d.item_code, d.name, d.type || 'raw_material', d.uom || 'Stk', d.unit_price ?? 0, d.acquisition_cost ?? 0, d.production_cost ?? 0, d.tax_rate ?? defaultRate, d.lead_time_days ?? 0, d.supplier_name ?? null,
        d.type ?? null, d.uom ?? null, d.unit_price ?? null, d.acquisition_cost ?? null, d.production_cost ?? null, d.tax_rate ?? null, d.lead_time_days ?? null, d.supplier_name ?? null]);
      result[r.inserted ? 'created' : 'updated'] += 1;
    }
  }

  if (type === 'customers') {
    for (const d of rows) {
      const existing = d.customer_number ? await db.get('SELECT * FROM customers WHERE customer_number = ?', [d.customer_number]) : null;
      const merged = { ...(existing || {}), ...d };
      const seller = (await db.get('SELECT country FROM companies WHERE id = nova_company_id()'))?.country || 'DE';
      merged.country = merged.country || seller;
      merged.tax_treatment = defaultTaxTreatment(merged.country, merged.vat_id, seller);
      if (existing) {
        const cols = Object.keys(d).concat('tax_treatment', 'country');
        await db.run(`UPDATE customers SET ${[...new Set(cols)].map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
          [...[...new Set(cols)].map((c) => merged[c]), existing.id]);
        result.updated += 1;
      } else {
        const number = d.customer_number || await numbering.nextNumber('customer');
        const datev = /^\d{5}$/.test(number) && Number(number) >= 10000 && Number(number) <= 69999 ? Number(number) : null;
        const all = { ...merged, customer_number: number, datev_account: datev };
        const cols = ['customer_number', 'name', 'name2', 'street', 'postal_code', 'city', 'country', 'vat_id', 'tax_treatment', 'email', 'invoice_email', 'phone', 'contact_person', 'payment_terms_days', 'leitweg_id', 'notes', 'datev_account'];
        await db.run(`INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => all[c] ?? null));
        result.created += 1;
      }
    }
  }

  if (type === 'suppliers') {
    for (const d of rows) {
      const existing = await db.get('SELECT id FROM suppliers WHERE lower(name) = lower(?)', [d.name]);
      const cols = Object.keys(d);
      if (existing) {
        await db.run(`UPDATE suppliers SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => d[c]), existing.id]);
        result.updated += 1;
      } else {
        await db.run(`INSERT INTO suppliers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => d[c]));
        result.created += 1;
      }
    }
  }

  if (type === 'stock') {
    const ids = new Map((await db.all('SELECT id, item_code FROM items')).map((i) => [i.item_code, i.id]));
    // Opening stock per item = sum of its rows (lots).
    const totals = new Map();
    for (const d of rows) totals.set(d.item_code, (totals.get(d.item_code) || 0) + d.quantity);
    for (const d of rows) {
      const itemId = ids.get(d.item_code);
      if (d.lot_number) {
        await db.run(`
          INSERT INTO inventory_lots (item_id, lot_number, quantity, expiration_date) VALUES (?, ?, ?, ?)
          ON CONFLICT (company_id, lot_number) DO UPDATE SET quantity = EXCLUDED.quantity, expiration_date = EXCLUDED.expiration_date`,
        [itemId, d.lot_number, d.quantity, d.expiration_date ?? null]);
      }
    }
    for (const [code, qty] of totals) {
      const itemId = ids.get(code);
      const before = await db.get('SELECT quantity FROM stock_levels WHERE item_id = ?', [itemId]);
      const location = rows.find((d) => d.item_code === code && d.location)?.location ?? null;
      await db.run(`
        INSERT INTO stock_levels (item_id, quantity, location, last_updated) VALUES (?, ?, ?, nova_now())
        ON CONFLICT (item_id) DO UPDATE SET quantity = EXCLUDED.quantity, location = COALESCE(EXCLUDED.location, stock_levels.location), last_updated = nova_now()`,
      [itemId, qty, location]);
      await db.run(`
        INSERT INTO stock_transactions (item_id, quantity, type, reference_type, user_id)
        VALUES (?, ?, 'adjustment', 'import', ?)`, [itemId, qty - (before?.quantity ?? 0), userId]);
      result[before ? 'updated' : 'created'] += 1;
    }
  }

  if (type === 'boms') {
    const ids = new Map((await db.all('SELECT id, item_code, name FROM items')).map((i) => [i.item_code, i]));
    const byParent = new Map();
    for (const d of rows) {
      if (!byParent.has(d.parent_item_code)) byParent.set(d.parent_item_code, []);
      byParent.get(d.parent_item_code).push(d);
    }
    for (const [parentCode, comps] of byParent) {
      const parent = ids.get(parentCode);
      let bom = await db.get('SELECT id FROM boms WHERE parent_item_id = ? ORDER BY id LIMIT 1', [parent.id]);
      if (bom) {
        await db.run('DELETE FROM bom_positions WHERE bom_id = ?', [bom.id]);
        result.updated += 1;
      } else {
        bom = await db.get('INSERT INTO boms (parent_item_id, name, description) VALUES (?, ?, ?) RETURNING id', [parent.id, `Stückliste ${parent.item_code}`, 'Import']);
        result.created += 1;
      }
      for (const [i, d] of comps.entries()) {
        await db.run(`
          INSERT INTO bom_positions (bom_id, item_id, position_code, quantity, level, sort_order, node_type)
          VALUES (?, ?, ?, ?, 1, ?, 'component')`,
        [bom.id, ids.get(d.component_item_code).id, d.position_code || String((i + 1) * 10), d.quantity, i]);
      }
    }
  }
  return { ...result, rows: rows.length };
}

/** Excel template with the expected columns and one example row. */
function template(type) {
  if (!FIELDS[type]) throw badRequest(`Unknown import type ${type}`);
  const headers = FIELDS[type].map((f) => f.names[0]);
  const example = FIELDS[type].map((f) => EXAMPLES[type][f.key] ?? '');
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { preview, commit, template, parseNumber, parseDate, FIELDS, autoMapping };
