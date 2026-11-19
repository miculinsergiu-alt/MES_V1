-- Files attached to records (material certificates, drawings, NC programs,
-- measurement reports, 8D reports …). Stored in the database like the
-- archived sales documents, so backups contain them.

CREATE TABLE attachments (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('lot','item','order','receipt','complaint','customer','supplier','project')),
  owner_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('certificate','drawing','nc_program','report','photo','other')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content BYTEA NOT NULL,
  sha256 TEXT NOT NULL,
  -- Drawings / NC programs: revision index (A, B, 01 …); only one current revision per item and kind.
  revision TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  -- Material certificates (EN 10204): type and heat number (Schmelze).
  cert_type TEXT CHECK (cert_type IN ('2.1','2.2','3.1','3.2')),
  heat_number TEXT,
  notes TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now()
);
CREATE INDEX attachments_owner ON attachments (company_id, owner_type, owner_id, kind);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attachments
  USING (nova_is_system() OR company_id = nova_company_id())
  WITH CHECK (nova_is_system() OR company_id = nova_company_id());

-- Production orders remember the drawing / NC program revision they were planned with.
ALTER TABLE orders ADD COLUMN drawing_attachment_id INTEGER REFERENCES attachments(id);
ALTER TABLE orders ADD COLUMN nc_attachment_id INTEGER REFERENCES attachments(id);

-- Customers that need material certificates with every delivery.
ALTER TABLE customers ADD COLUMN requires_certificates INTEGER NOT NULL DEFAULT 0;
-- Items made of certified material (raw material that needs a certificate at goods receipt).
ALTER TABLE items ADD COLUMN requires_certificate INTEGER NOT NULL DEFAULT 0;
