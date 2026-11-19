-- Projects: group quotes, orders, invoices, production orders, purchases and
-- outside processing of one customer job; budget vs. actual.
-- Links live in their own table so GoBD-locked documents stay untouched.

CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  budget_cost NUMERIC(14,2),
  budget_revenue NUMERIC(14,2),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, number)
);

CREATE TABLE project_links (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('sales_document','production_order','purchase_order','subcontract_job')),
  ref_id INTEGER NOT NULL,
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, kind, ref_id)
);
CREATE INDEX project_links_project ON project_links (project_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','project_links']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (nova_is_system() OR company_id = nova_company_id()) WITH CHECK (nova_is_system() OR company_id = nova_company_id())', t);
  END LOOP;
END $$;

ALTER TABLE number_series DROP CONSTRAINT number_series_doc_type_check;
ALTER TABLE number_series ADD CONSTRAINT number_series_doc_type_check
  CHECK (doc_type IN ('quote','order','delivery','invoice','credit_note','customer','dunning','purchase_order','subcontract_delivery','complaint','blanket_order','project'));
