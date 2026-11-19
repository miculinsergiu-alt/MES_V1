-- Blanket orders (Rahmenaufträge): a framework agreement with total
-- quantities and fixed prices for a period; the customer calls off partial
-- quantities, each call-off becomes a normal order confirmation.

CREATE TABLE blanket_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  customer_reference TEXT,
  valid_from TEXT,
  valid_to TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','cancelled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, number)
);

CREATE TABLE blanket_order_lines (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  blanket_id INTEGER NOT NULL REFERENCES blanket_orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id),
  description TEXT,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit TEXT,
  unit_price NUMERIC(14,4) NOT NULL DEFAULT 0
);

CREATE TABLE blanket_calloffs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  blanket_line_id INTEGER NOT NULL REFERENCES blanket_order_lines(id),
  sales_document_id INTEGER NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  created_at TEXT DEFAULT nova_now()
);
CREATE INDEX blanket_calloffs_line ON blanket_calloffs (blanket_line_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['blanket_orders','blanket_order_lines','blanket_calloffs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (nova_is_system() OR company_id = nova_company_id()) WITH CHECK (nova_is_system() OR company_id = nova_company_id())', t);
  END LOOP;
END $$;

ALTER TABLE number_series DROP CONSTRAINT number_series_doc_type_check;
ALTER TABLE number_series ADD CONSTRAINT number_series_doc_type_check
  CHECK (doc_type IN ('quote','order','delivery','invoice','credit_note','customer','dunning','purchase_order','subcontract_delivery','complaint','blanket_order'));
