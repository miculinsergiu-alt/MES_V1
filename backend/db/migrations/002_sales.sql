-- Phase 1: company settings, number series, customers, sales documents
-- (quote, order confirmation, delivery note, invoice, credit note),
-- payments, dunning and archived document files.

-- ─── New roles ──────────────────────────────────────────────────────────────

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'administrator','planner','area_supervisor','shift_responsible','operator',
  'warehouse_manager','material_planner','sales','accounting'));

-- ─── Items: sales VAT rate ──────────────────────────────────────────────────

ALTER TABLE items ADD COLUMN tax_rate NUMERIC(5,2) NOT NULL DEFAULT 19 CHECK (tax_rate IN (0, 7, 19));

-- ─── Company settings (data printed on documents, §14 UStG) ─────────────────

ALTER TABLE companies
  ADD COLUMN legal_name TEXT,
  ADD COLUMN street TEXT,
  ADD COLUMN postal_code TEXT,
  ADD COLUMN city TEXT,
  ADD COLUMN country TEXT NOT NULL DEFAULT 'DE',
  ADD COLUMN tax_number TEXT,                 -- Steuernummer
  ADD COLUMN register_court TEXT,             -- Registergericht, e.g. "Amtsgericht München"
  ADD COLUMN register_number TEXT,            -- e.g. "HRB 123456"
  ADD COLUMN managing_directors TEXT,         -- Geschäftsführer
  ADD COLUMN email TEXT,
  ADD COLUMN phone TEXT,
  ADD COLUMN website TEXT,
  ADD COLUMN bank_name TEXT,
  ADD COLUMN iban TEXT,
  ADD COLUMN bic TEXT,
  ADD COLUMN logo_data_url TEXT,              -- PNG/JPEG as data URL, max ~300 KB
  ADD COLUMN default_payment_terms_days INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN default_skonto_days INTEGER,
  ADD COLUMN default_skonto_percent NUMERIC(5,2),
  ADD COLUMN small_business INTEGER NOT NULL DEFAULT 0,   -- Kleinunternehmer §19 UStG
  ADD COLUMN invoice_footer_text TEXT,
  ADD COLUMN datev_consultant_number INTEGER, -- Beraternummer
  ADD COLUMN datev_client_number INTEGER,     -- Mandantennummer
  ADD COLUMN datev_chart TEXT NOT NULL DEFAULT 'SKR03' CHECK (datev_chart IN ('SKR03','SKR04')),
  ADD COLUMN dunning_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN dunning_grace_days INTEGER NOT NULL DEFAULT 7;

-- Company administrators may update their own company's settings.
CREATE POLICY company_update_own ON companies FOR UPDATE
  USING (id = nova_company_id()) WITH CHECK (id = nova_company_id());

-- ─── Number series (gap-free) ───────────────────────────────────────────────
-- A number is taken inside the transaction that issues the document, with a
-- row lock: if the transaction fails, the number is not used — no gaps.

CREATE TABLE number_series (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('quote','order','delivery','invoice','credit_note','customer','dunning')),
  prefix TEXT NOT NULL,
  yearly_reset INTEGER NOT NULL DEFAULT 1,
  digits INTEGER NOT NULL DEFAULT 5 CHECK (digits BETWEEN 3 AND 10),
  year INTEGER NOT NULL DEFAULT 0,
  next_number INTEGER NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_type)
);

-- ─── Customers ──────────────────────────────────────────────────────────────

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  customer_number TEXT NOT NULL,
  name TEXT NOT NULL,
  name2 TEXT,
  street TEXT,
  postal_code TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'DE' CHECK (country ~ '^[A-Z]{2}$'),
  vat_id TEXT,
  tax_treatment TEXT NOT NULL DEFAULT 'domestic' CHECK (tax_treatment IN ('domestic','intra_eu','export')),
  contact_person TEXT,
  email TEXT,
  invoice_email TEXT,
  phone TEXT,
  payment_terms_days INTEGER,
  skonto_days INTEGER,
  skonto_percent NUMERIC(5,2),
  leitweg_id TEXT,                          -- buyer reference for XRechnung (public sector)
  datev_account INTEGER,                    -- Debitorenkonto
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, customer_number)
);

-- ─── Sales documents ────────────────────────────────────────────────────────

CREATE TABLE sales_documents (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('quote','order','delivery','invoice','credit_note')),
  number TEXT,                              -- assigned when issued
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','issued','accepted','declined','partially_delivered','delivered','closed',
    'partially_paid','paid','cancelled')),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  -- Customer data as printed on the document (frozen when issued)
  customer_name TEXT,
  customer_address TEXT,
  customer_country TEXT,
  customer_vat_id TEXT,
  tax_treatment TEXT NOT NULL DEFAULT 'domestic' CHECK (tax_treatment IN ('domestic','intra_eu','export','small_business')),
  document_date TEXT NOT NULL DEFAULT nova_today(),
  service_date TEXT,                        -- Leistungsdatum (§14 Abs. 4 Nr. 6 UStG)
  service_period_end TEXT,
  valid_until TEXT,                         -- quotes
  delivery_date TEXT,                       -- requested / planned delivery (orders)
  due_date TEXT,
  payment_terms_days INTEGER,
  skonto_days INTEGER,
  skonto_percent NUMERIC(5,2),
  currency TEXT NOT NULL DEFAULT 'EUR',
  customer_reference TEXT,                  -- customer's PO number
  buyer_reference TEXT,                     -- Leitweg-ID (XRechnung BT-10)
  intro_text TEXT,
  closing_text TEXT,
  internal_notes TEXT,
  source_document_id INTEGER REFERENCES sales_documents(id),
  cancels_document_id INTEGER REFERENCES sales_documents(id),
  net_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_breakdown TEXT,                       -- JSON
  paid_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  credited_total NUMERIC(14,2) NOT NULL DEFAULT 0,      -- invoices: sum of issued credit notes
  dunning_level INTEGER NOT NULL DEFAULT 0,
  last_dunning_date TEXT,
  issued_at TEXT,
  issued_by INTEGER REFERENCES users(id),
  locked INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,                        -- SHA-256 of the issued content (GoBD integrity)
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now(),
  updated_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, doc_type, number)
);

CREATE TABLE sales_document_lines (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id),
  item_code TEXT,
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'Stk',
  unit_price NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) NOT NULL DEFAULT 19,
  tax_category TEXT NOT NULL DEFAULT 'S' CHECK (tax_category IN ('S','Z','E','AE','K','G','O')),
  line_net NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_line_id INTEGER REFERENCES sales_document_lines(id),
  delivered_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,   -- order lines
  invoiced_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,    -- order / delivery lines
  production_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL
);

ALTER TABLE orders ADD COLUMN sales_line_id INTEGER REFERENCES sales_document_lines(id) ON DELETE SET NULL;

-- ─── Payments & dunning ─────────────────────────────────────────────────────

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES sales_documents(id),
  payment_date TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  method TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('bank_transfer','cash','direct_debit','card','other')),
  reference TEXT,
  skonto_amount NUMERIC(14,2) NOT NULL DEFAULT 0,       -- discount taken by the customer
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE dunning_notices (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES sales_documents(id),
  number TEXT,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  notice_date TEXT NOT NULL DEFAULT nova_today(),
  open_amount NUMERIC(14,2) NOT NULL,
  fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  new_due_date TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now()
);

-- ─── Archived files (issued PDFs / e-invoices, GoBD retention) ──────────────

CREATE TABLE document_files (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  document_id INTEGER REFERENCES sales_documents(id),
  dunning_id INTEGER REFERENCES dunning_notices(id),
  kind TEXT NOT NULL CHECK (kind IN ('pdf','zugferd','xrechnung')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  content BYTEA NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT DEFAULT nova_now()
);

CREATE INDEX idx_sales_docs_company_type ON sales_documents(company_id, doc_type, status);
CREATE INDEX idx_sales_docs_customer ON sales_documents(customer_id);
CREATE INDEX idx_sales_lines_document ON sales_document_lines(document_id);
CREATE INDEX idx_payments_document ON payments(document_id);
CREATE INDEX idx_document_files_document ON document_files(document_id);

-- ─── Same-company references for the new tables (see 001) ───────────────────

DO $$
DECLARE
  t text;
  r record;
  on_delete text;
BEGIN
  FOREACH t IN ARRAY ARRAY['number_series','customers','sales_documents','sales_document_lines','payments','dunning_notices','document_files']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (id, company_id)', t, t || '_id_company_key');
  END LOOP;

  FOR r IN
    SELECT con.conname, cl.relname AS child, pcl.relname AS parent, att.attname AS col, con.confdeltype
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_class pcl ON pcl.oid = con.confrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND cl.relnamespace = 'public'::regnamespace
      AND pcl.relname <> 'companies'
      AND (cl.relname IN ('number_series','customers','sales_documents','sales_document_lines','payments','dunning_notices','document_files')
           OR (cl.relname = 'orders' AND att.attname = 'sales_line_id'))
  LOOP
    on_delete := CASE r.confdeltype
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN format('SET NULL (%I)', r.col)
      ELSE 'NO ACTION'
    END;
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.child, r.conname);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I, company_id) REFERENCES %I (id, company_id) ON DELETE %s',
      r.child, r.conname, r.col, r.parent, on_delete
    );
  END LOOP;

  FOREACH t IN ARRAY ARRAY['number_series','customers','sales_documents','sales_document_lines','payments','dunning_notices','document_files']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (nova_is_system() OR company_id = nova_company_id()) WITH CHECK (nova_is_system() OR company_id = nova_company_id())',
      t
    );
  END LOOP;
END $$;

-- ─── GoBD: issued documents cannot be changed or deleted ────────────────────
-- Enforced in the database, so no code path (or bug) can alter an issued
-- invoice. Only payment/dunning status may still change.

CREATE OR REPLACE FUNCTION nova_protect_issued_document() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked = 1 THEN
      RAISE EXCEPTION 'Issued document % cannot be deleted', OLD.number USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.locked = 1 THEN
    IF NEW.locked <> 1
       OR (to_jsonb(NEW) - ARRAY['status','paid_total','credited_total','dunning_level','last_dunning_date','updated_at'])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status','paid_total','credited_total','dunning_level','last_dunning_date','updated_at']) THEN
      RAISE EXCEPTION 'Issued document % cannot be changed', OLD.number USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_protect_issued_document
  BEFORE UPDATE OR DELETE ON sales_documents
  FOR EACH ROW EXECUTE FUNCTION nova_protect_issued_document();

CREATE OR REPLACE FUNCTION nova_protect_issued_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  doc_id integer;
  is_locked integer;
BEGIN
  doc_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.document_id ELSE OLD.document_id END;
  SELECT locked INTO is_locked FROM sales_documents WHERE id = doc_id;
  IF is_locked = 1 THEN
    -- Delivered/invoiced quantity tracking on order and delivery lines stays possible.
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - ARRAY['delivered_quantity','invoiced_quantity','production_order_id'])
           = (to_jsonb(OLD) - ARRAY['delivered_quantity','invoiced_quantity','production_order_id']) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Lines of an issued document cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER trg_protect_issued_lines
  BEFORE INSERT OR UPDATE OR DELETE ON sales_document_lines
  FOR EACH ROW EXECUTE FUNCTION nova_protect_issued_lines();

-- Archived files and payments are write-once.
CREATE OR REPLACE FUNCTION nova_write_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Records in % cannot be changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

CREATE TRIGGER trg_protect_files
  BEFORE UPDATE OR DELETE ON document_files
  FOR EACH ROW EXECUTE FUNCTION nova_write_once();

-- Payments are corrected by a counter-entry, never edited or deleted.
CREATE TRIGGER trg_protect_payments
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION nova_write_once();
