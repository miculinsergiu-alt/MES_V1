-- Quality: inspection plan per item, measurements per production order or
-- goods receipt, gauges with calibration dates, customer complaints with 8D.

-- Gauges (Prüfmittel): calipers, micrometers, thread gauges …
CREATE TABLE gauges (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  gauge_type TEXT,
  location TEXT,
  interval_months INTEGER NOT NULL DEFAULT 12,
  last_calibrated TEXT,
  next_due TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, code)
);

-- Inspection plan (Prüfplan): characteristics of an item.
CREATE TABLE inspection_characteristics (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,                       -- e.g. "Ø 25 h7", "Länge 120", "Gewinde M8", "Oberfläche"
  kind TEXT NOT NULL DEFAULT 'measure' CHECK (kind IN ('measure','attribute')),
  nominal NUMERIC(14,5),
  lower_limit NUMERIC(14,5),
  upper_limit NUMERIC(14,5),
  unit TEXT NOT NULL DEFAULT 'mm',
  frequency TEXT NOT NULL DEFAULT 'first' CHECK (frequency IN ('first','every_n','final','each')),
  every_n INTEGER,
  critical INTEGER NOT NULL DEFAULT 0,
  gauge_id INTEGER REFERENCES gauges(id),
  incoming INTEGER NOT NULL DEFAULT 0,      -- also checked at goods receipt (for purchased items)
  active INTEGER NOT NULL DEFAULT 1,
  CHECK (kind = 'attribute' OR (lower_limit IS NOT NULL AND upper_limit IS NOT NULL AND lower_limit <= upper_limit))
);
CREATE INDEX inspection_characteristics_item ON inspection_characteristics (company_id, item_id);

CREATE TABLE measurements (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  characteristic_id INTEGER NOT NULL REFERENCES inspection_characteristics(id),
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,          -- root production order
  receipt_item_id INTEGER REFERENCES goods_receipt_items(id),      -- incoming inspection
  stage TEXT NOT NULL CHECK (stage IN ('first','in_process','final','incoming')),
  sample_no INTEGER NOT NULL DEFAULT 1,
  value NUMERIC(14,5),
  attribute_ok INTEGER,
  result TEXT NOT NULL CHECK (result IN ('ok','nok')),
  gauge_id INTEGER REFERENCES gauges(id),
  measured_by INTEGER REFERENCES users(id),
  measured_at TEXT DEFAULT nova_now(),
  notes TEXT,
  CHECK (order_id IS NOT NULL OR receipt_item_id IS NOT NULL)
);
CREATE INDEX measurements_order ON measurements (company_id, order_id);

-- An out-of-tolerance value puts the order on hold until quality releases it.
ALTER TABLE orders ADD COLUMN quality_hold INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN quality_released_by INTEGER REFERENCES users(id);
ALTER TABLE orders ADD COLUMN quality_released_at TEXT;

-- Customer complaints (Reklamation) with the 8D method.
CREATE TABLE complaints (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  item_id INTEGER REFERENCES items(id),
  lot_number TEXT,
  delivery_document_id INTEGER REFERENCES sales_documents(id),
  customer_reference TEXT,
  quantity NUMERIC(14,3),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','analysis','action','closed','rejected')),
  d1_team TEXT, d2_problem TEXT, d3_containment TEXT, d4_root_cause TEXT,
  d5_corrective TEXT, d6_implemented TEXT, d7_prevention TEXT, d8_closure TEXT,
  cost NUMERIC(14,2),
  due_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now(),
  closed_at TEXT,
  UNIQUE (company_id, number)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['gauges','inspection_characteristics','measurements','complaints']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (nova_is_system() OR company_id = nova_company_id()) WITH CHECK (nova_is_system() OR company_id = nova_company_id())', t);
  END LOOP;
END $$;

ALTER TABLE number_series DROP CONSTRAINT number_series_doc_type_check;
ALTER TABLE number_series ADD CONSTRAINT number_series_doc_type_check
  CHECK (doc_type IN ('quote','order','delivery','invoice','credit_note','customer','dunning','purchase_order','subcontract_delivery','complaint'));
