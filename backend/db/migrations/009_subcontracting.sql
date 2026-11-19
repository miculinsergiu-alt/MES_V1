-- Outside processing (Fremdbearbeitung / Lohnbearbeitung): a routing step done
-- by a subcontractor (anodising, hardening, galvanising, grinding …).
-- Also: setup time per routing step (used by quoting and scheduling).

ALTER TABLE item_routes ALTER COLUMN machine_id DROP NOT NULL;
ALTER TABLE item_routes ADD COLUMN step_type TEXT NOT NULL DEFAULT 'internal' CHECK (step_type IN ('internal','external'));
ALTER TABLE item_routes ADD COLUMN setup_time_min INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item_routes ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
ALTER TABLE item_routes ADD COLUMN external_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item_routes ADD COLUMN external_price NUMERIC(14,4) NOT NULL DEFAULT 0;  -- € per piece
ALTER TABLE item_routes ADD COLUMN external_min_charge NUMERIC(14,2) NOT NULL DEFAULT 0; -- € minimum per batch
ALTER TABLE item_routes ADD CONSTRAINT item_routes_step_kind CHECK (
  (step_type = 'internal' AND machine_id IS NOT NULL) OR (step_type = 'external' AND supplier_id IS NOT NULL)
);

ALTER TABLE purchase_orders ADD COLUMN po_type TEXT NOT NULL DEFAULT 'material' CHECK (po_type IN ('material','subcontract'));

CREATE TABLE subcontract_jobs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,     -- root production order
  routing_sequence INTEGER NOT NULL,
  item_id INTEGER REFERENCES items(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  description TEXT NOT NULL,                                               -- e.g. "Eloxieren schwarz"
  quantity NUMERIC(14,3) NOT NULL,
  price_per_unit NUMERIC(14,4) NOT NULL DEFAULT 0,
  min_charge NUMERIC(14,2) NOT NULL DEFAULT 0,
  planned_send TEXT,
  planned_return TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','sent','received','cancelled')),
  po_id INTEGER REFERENCES purchase_orders(id),
  delivery_note_number TEXT,
  sent_quantity NUMERIC(14,3),
  sent_at TEXT,
  received_ok NUMERIC(14,3),
  received_fail NUMERIC(14,3),
  received_at TEXT,
  actual_cost NUMERIC(14,2),
  notes TEXT,
  created_at TEXT DEFAULT nova_now()
);
CREATE INDEX subcontract_jobs_order ON subcontract_jobs (order_id);
CREATE INDEX subcontract_jobs_status ON subcontract_jobs (company_id, status);

ALTER TABLE subcontract_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontract_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subcontract_jobs
  USING (nova_is_system() OR company_id = nova_company_id())
  WITH CHECK (nova_is_system() OR company_id = nova_company_id());

-- Outgoing delivery notes for subcontractors get their own number series (LL-2026-00001).
ALTER TABLE number_series DROP CONSTRAINT number_series_doc_type_check;
ALTER TABLE number_series ADD CONSTRAINT number_series_doc_type_check
  CHECK (doc_type IN ('quote','order','delivery','invoice','credit_note','customer','dunning','purchase_order','subcontract_delivery'));
