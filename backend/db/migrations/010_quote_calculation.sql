-- Vorkalkulation: price a part from material, setup, cycle times × machine
-- rates, outside processing, overhead and margin, for several quantities.

ALTER TABLE companies ADD COLUMN calc_material_surcharge NUMERIC(6,2) NOT NULL DEFAULT 10; -- % Materialgemeinkosten
ALTER TABLE companies ADD COLUMN calc_overhead NUMERIC(6,2) NOT NULL DEFAULT 15;          -- % on production cost (Fertigungsgemeinkosten / Verwaltung)
ALTER TABLE companies ADD COLUMN calc_margin NUMERIC(6,2) NOT NULL DEFAULT 15;            -- % Gewinnzuschlag

-- Saved calculations (snapshot of input and result), linkable to quote lines,
-- so the actual costing can later be compared with what was quoted.
CREATE TABLE quote_calculations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  customer_id INTEGER REFERENCES customers(id),
  input JSONB NOT NULL,
  result JSONB NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now()
);
CREATE INDEX quote_calculations_item ON quote_calculations (company_id, item_id);
ALTER TABLE quote_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_calculations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quote_calculations
  USING (nova_is_system() OR company_id = nova_company_id())
  WITH CHECK (nova_is_system() OR company_id = nova_company_id());

-- Which calculation a quote/order line was priced with (drafts only; issued lines stay locked).
ALTER TABLE sales_document_lines ADD COLUMN calculation_id INTEGER REFERENCES quote_calculations(id);

-- Won / lost reasons for quotes, kept outside the GoBD-locked document.
CREATE TABLE quote_outcomes (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL UNIQUE REFERENCES sales_documents(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('won','lost')),
  reason TEXT CHECK (reason IN ('price','delivery_time','quality','no_demand','competitor','other')),
  competitor TEXT,
  competitor_price NUMERIC(14,2),
  notes TEXT,
  created_at TEXT DEFAULT nova_now()
);
ALTER TABLE quote_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_outcomes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quote_outcomes
  USING (nova_is_system() OR company_id = nova_company_id())
  WITH CHECK (nova_is_system() OR company_id = nova_company_id());
