-- Incoming supplier invoices (e-invoices: ZUGFeRD / Factur-X PDF, XRechnung
-- CII or UBL XML). Since 2025 every German business must be able to receive
-- them. The original file is archived unchanged (GoBD).

CREATE TABLE purchase_invoices (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id),
  po_id INTEGER REFERENCES purchase_orders(id),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','approved','rejected','paid')),
  format TEXT NOT NULL,                     -- e.g. 'ZUGFeRD/Factur-X (CII)', 'XRechnung (UBL)'
  profile TEXT,                             -- guideline / customization id
  type_code TEXT,                           -- 380 invoice, 381 credit note
  invoice_number TEXT NOT NULL,
  invoice_date TEXT,
  due_date TEXT,
  delivery_date TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  seller_name TEXT,
  seller_vat_id TEXT,
  seller_tax_number TEXT,
  seller_iban TEXT,
  buyer_reference TEXT,
  order_reference TEXT,
  net_total NUMERIC(14,2),
  tax_total NUMERIC(14,2),
  gross_total NUMERIC(14,2),
  due_amount NUMERIC(14,2),
  parsed TEXT NOT NULL,                     -- JSON of all extracted data (lines, taxes, parties)
  warnings TEXT,                            -- JSON array of plausibility warnings
  notes TEXT,
  original_filename TEXT NOT NULL,
  original_mime TEXT NOT NULL,
  original_content BYTEA NOT NULL,
  original_sha256 TEXT NOT NULL,
  received_by INTEGER REFERENCES users(id),
  received_at TEXT DEFAULT nova_now(),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT
);

CREATE INDEX idx_purchase_invoices_company_status ON purchase_invoices(company_id, status);
-- Same invoice number from the same supplier (by VAT ID or name) = duplicate
CREATE INDEX idx_purchase_invoices_dup ON purchase_invoices(company_id, invoice_number);

ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_id_company_key UNIQUE (id, company_id);
ALTER TABLE purchase_invoices DROP CONSTRAINT purchase_invoices_supplier_id_fkey;
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_supplier_id_fkey
  FOREIGN KEY (supplier_id, company_id) REFERENCES suppliers(id, company_id);
ALTER TABLE purchase_invoices DROP CONSTRAINT purchase_invoices_po_id_fkey;
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_po_id_fkey
  FOREIGN KEY (po_id, company_id) REFERENCES purchase_orders(id, company_id);
ALTER TABLE purchase_invoices DROP CONSTRAINT purchase_invoices_received_by_fkey;
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_received_by_fkey
  FOREIGN KEY (received_by, company_id) REFERENCES users(id, company_id);
ALTER TABLE purchase_invoices DROP CONSTRAINT purchase_invoices_decided_by_fkey;
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_decided_by_fkey
  FOREIGN KEY (decided_by, company_id) REFERENCES users(id, company_id);

ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_invoices
  USING (nova_is_system() OR company_id = nova_company_id())
  WITH CHECK (nova_is_system() OR company_id = nova_company_id());

-- The archived original and the extracted invoice data never change;
-- only the workflow fields (status, assignment, notes) may be updated.
CREATE OR REPLACE FUNCTION nova_protect_purchase_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Received invoices cannot be deleted (archiving obligation)' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','supplier_id','po_id','notes','decided_by','decided_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','supplier_id','po_id','notes','decided_by','decided_at']) THEN
    RAISE EXCEPTION 'The received invoice and its original file cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_protect_purchase_invoice
  BEFORE UPDATE OR DELETE ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION nova_protect_purchase_invoice();
