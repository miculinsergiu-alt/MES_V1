-- NOVA initial PostgreSQL schema (multi-company).
--
-- Every business table carries company_id. Row-level security policies make
-- each request see only the rows of its own company (set per transaction via
-- the app.company_id setting, see db/index.js).
--
-- Date/time columns are stored as local-time text 'YYYY-MM-DD HH:MM:SS' in the
-- company's time zone, matching what the frontend expects.

-- ─── Helper functions ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION nova_company_id() RETURNS integer
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::integer $$;

CREATE OR REPLACE FUNCTION nova_is_system() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.system', true), '') = 'on' $$;

-- Local "now" as text in the session time zone (set per transaction).
CREATE OR REPLACE FUNCTION nova_now() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT to_char(LOCALTIMESTAMP, 'YYYY-MM-DD HH24:MI:SS') $$;

CREATE OR REPLACE FUNCTION nova_today() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT to_char(LOCALTIMESTAMP, 'YYYY-MM-DD') $$;

-- ─── Companies (tenants) ────────────────────────────────────────────────────

CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  locale TEXT NOT NULL DEFAULT 'de-DE',
  currency TEXT NOT NULL DEFAULT 'EUR',
  vat_id TEXT,
  address TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Users & shifts ─────────────────────────────────────────────────────────

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  badge_number TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('administrator','planner','area_supervisor','shift_responsible','operator','warehouse_manager','material_planner')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, badge_number)
);

CREATE TABLE shifts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  shift_responsible_id INTEGER REFERENCES users(id),
  start_time TEXT,
  end_time TEXT,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE shift_members (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (shift_id, user_id)
);

-- ─── Areas & machines ───────────────────────────────────────────────────────

CREATE TABLE areas (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE machines (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  area_id INTEGER NOT NULL REFERENCES areas(id),
  name TEXT NOT NULL,
  setup_time_min INTEGER DEFAULT 30,
  working_time_min INTEGER DEFAULT 480,
  supervision_time_min INTEGER DEFAULT 30,
  total_running_hours DOUBLE PRECISION DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE operator_schedules (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (user_id, work_date, shift_id)
);

-- ─── Items & BOMs ───────────────────────────────────────────────────────────

CREATE TABLE items (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('raw_material','semi_finished','finished_good')),
  uom TEXT DEFAULT 'Stk',
  acquisition_cost DOUBLE PRECISION DEFAULT 0,
  production_cost DOUBLE PRECISION DEFAULT 0,
  unit_price DOUBLE PRECISION DEFAULT 0,
  production_time_min INTEGER DEFAULT 0,
  sop_url TEXT,
  drawing_url TEXT,
  supplier_name TEXT,
  lead_time_days INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, item_code)
);

CREATE TABLE item_routes (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  sequence INTEGER NOT NULL,
  process_time_min INTEGER DEFAULT 0,
  notes TEXT
);

CREATE TABLE requirements (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  UNIQUE (company_id, name)
);

CREATE TABLE boms (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  parent_item_id INTEGER REFERENCES items(id),
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE bom_positions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  bom_id INTEGER NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  position_code TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  start_date TEXT,
  finish_date TEXT,
  location TEXT,
  requirement_id INTEGER REFERENCES requirements(id),
  parent_position_id INTEGER REFERENCES bom_positions(id) ON DELETE CASCADE,
  level INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  department TEXT,
  node_type TEXT DEFAULT 'component' CHECK (node_type IN ('department','component')),
  created_at TEXT DEFAULT nova_now()
);

-- ─── Production orders ──────────────────────────────────────────────────────

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  product_name TEXT NOT NULL,
  item_id INTEGER REFERENCES items(id),
  bom_id INTEGER REFERENCES boms(id),
  quantity INTEGER NOT NULL,
  planned_start TEXT NOT NULL,
  planned_end TEXT NOT NULL,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','active','done','cancelled')),
  order_type TEXT DEFAULT 'production' CHECK (order_type IN ('production','maintenance')),
  created_by INTEGER REFERENCES users(id),
  parent_order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  routing_sequence INTEGER DEFAULT 0,
  is_fixed_time INTEGER DEFAULT 0,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE delay_reasons (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  UNIQUE (company_id, name)
);

CREATE TABLE order_delays (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  delay_minutes INTEGER NOT NULL,
  reason TEXT,
  delay_reason_id INTEGER REFERENCES delay_reasons(id),
  corrective_action TEXT,
  reported_by INTEGER REFERENCES users(id),
  source TEXT CHECK (source IN ('operator','shift_responsible','system')),
  applied INTEGER DEFAULT 0,
  created_at TEXT DEFAULT nova_now()
);

-- ─── Production tracking ────────────────────────────────────────────────────

CREATE TABLE machine_allocations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  operator_id INTEGER NOT NULL REFERENCES users(id),
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  phase TEXT CHECK (phase IN ('setup','working','supervision')),
  delay_confirmed INTEGER DEFAULT 0,
  delay_minutes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE operator_actions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  allocation_id INTEGER NOT NULL REFERENCES machine_allocations(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('setup_start','setup_end','working_start','working_end','supervision_start','supervision_end','delay_start','delay_end')),
  timestamp TEXT DEFAULT nova_now(),
  notes TEXT
);

CREATE TABLE production_results (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  operator_id INTEGER REFERENCES users(id),
  qty_ok INTEGER DEFAULT 0,
  qty_fail INTEGER DEFAULT 0,
  completed_at TEXT DEFAULT nova_now()
);

CREATE TABLE defect_reasons (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  UNIQUE (company_id, name)
);

CREATE TABLE defect_logs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  result_id INTEGER NOT NULL REFERENCES production_results(id) ON DELETE CASCADE,
  reason_id INTEGER NOT NULL REFERENCES defect_reasons(id),
  quantity INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT nova_now()
);

-- ─── Shift reports ──────────────────────────────────────────────────────────

CREATE TABLE shift_reports (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  shift_responsible_id INTEGER NOT NULL REFERENCES users(id),
  report_date TEXT NOT NULL,
  general_notes TEXT,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE report_issues (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  report_id INTEGER NOT NULL REFERENCES shift_reports(id) ON DELETE CASCADE,
  machine_id INTEGER REFERENCES machines(id),
  order_id INTEGER REFERENCES orders(id),
  description TEXT NOT NULL,
  delay_minutes INTEGER DEFAULT 0,
  delay_already_logged INTEGER DEFAULT 0,
  created_at TEXT DEFAULT nova_now()
);

-- ─── Audit log ──────────────────────────────────────────────────────────────

CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  old_data TEXT,
  new_data TEXT,
  timestamp TEXT DEFAULT nova_now()
);

-- ─── Inventory & lots ───────────────────────────────────────────────────────

CREATE TABLE stock_levels (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  quantity DOUBLE PRECISION DEFAULT 0,
  allocated_quantity DOUBLE PRECISION DEFAULT 0,
  location TEXT,
  last_updated TEXT DEFAULT nova_now()
);

CREATE TABLE inventory_lots (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  lot_number TEXT NOT NULL,
  quantity DOUBLE PRECISION DEFAULT 0,
  supplier_code TEXT,
  expiration_date TEXT,
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, lot_number)
);

CREATE TABLE stock_transactions (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_id INTEGER REFERENCES inventory_lots(id),
  quantity DOUBLE PRECISION NOT NULL,
  type TEXT CHECK (type IN ('in','out','adjustment')),
  reference_type TEXT,
  reference_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE order_material_lots (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_id INTEGER NOT NULL REFERENCES inventory_lots(id),
  quantity_used DOUBLE PRECISION NOT NULL,
  recorded_at TEXT DEFAULT nova_now()
);

CREATE TABLE order_material_allocations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  allocated_qty DOUBLE PRECISION NOT NULL,
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (order_id, item_id)
);

CREATE TABLE purchase_recommendations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  recommended_qty DOUBLE PRECISION NOT NULL,
  triggering_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','converted','dismissed')),
  created_at TEXT DEFAULT nova_now()
);

-- ─── Maintenance & skills ───────────────────────────────────────────────────

CREATE TABLE machine_maintenance_config (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL UNIQUE REFERENCES machines(id) ON DELETE CASCADE,
  interval_hours INTEGER NOT NULL,
  last_maintenance_hours DOUBLE PRECISION DEFAULT 0,
  warning_threshold_hours INTEGER DEFAULT 50
);

CREATE TABLE maintenance_logs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  technician_id INTEGER REFERENCES users(id),
  maintenance_date TEXT DEFAULT nova_today(),
  hours_at_maintenance DOUBLE PRECISION NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE operator_skills (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  skill_level TEXT DEFAULT 'independent' CHECK (skill_level IN ('trainee','independent','expert')),
  expiration_date TEXT,
  UNIQUE (user_id, machine_id)
);

-- ─── Suppliers, warehousing, procurement, quality ───────────────────────────

CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  vat_number TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE item_suppliers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchase_price DOUBLE PRECISION DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  lead_time_days INTEGER DEFAULT 0,
  last_negotiation_date TEXT,
  is_primary INTEGER DEFAULT 0,
  UNIQUE (item_id, supplier_id)
);

CREATE TABLE warehouses (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('central','production','quarantine','shipping')),
  description TEXT,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE warehouse_locations (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  zone TEXT,
  shelf TEXT,
  bin TEXT,
  barcode TEXT,
  active INTEGER DEFAULT 1,
  UNIQUE (company_id, barcode)
);

CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT DEFAULT 'ordered' CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  order_date TEXT DEFAULT nova_today(),
  expected_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE purchase_order_items (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity_ordered DOUBLE PRECISION NOT NULL,
  quantity_received DOUBLE PRECISION DEFAULT 0,
  unit_price DOUBLE PRECISION
);

CREATE TABLE goods_receipts (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  po_id INTEGER REFERENCES purchase_orders(id),
  received_by INTEGER NOT NULL REFERENCES users(id),
  received_at TEXT DEFAULT nova_now(),
  document_reference TEXT,
  notes TEXT
);

CREATE TABLE goods_receipt_items (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_number TEXT NOT NULL,
  quantity_received DOUBLE PRECISION NOT NULL,
  location_id INTEGER REFERENCES warehouse_locations(id),
  quality_status TEXT DEFAULT 'ok' CHECK (quality_status IN ('ok','quarantine','rejected')),
  expiration_date TEXT
);

CREATE TABLE quarantine_logs (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  receipt_item_id INTEGER REFERENCES goods_receipt_items(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_number TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  reported_by INTEGER NOT NULL REFERENCES users(id),
  photo_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','released','scrapped')),
  decision_by INTEGER REFERENCES users(id),
  decision_at TEXT,
  created_at TEXT DEFAULT nova_now()
);

CREATE TABLE stock_transfers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  from_warehouse_id INTEGER REFERENCES warehouses(id),
  to_warehouse_id INTEGER REFERENCES warehouses(id),
  status TEXT DEFAULT 'completed',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT nova_now(),
  completed_at TEXT
);

CREATE TABLE stock_transfer_items (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  lot_number TEXT,
  quantity DOUBLE PRECISION NOT NULL,
  from_location_id INTEGER REFERENCES warehouse_locations(id),
  to_location_id INTEGER REFERENCES warehouse_locations(id)
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX idx_users_company ON users(company_id);
CREATE INDEX idx_orders_company_machine_start ON orders(company_id, machine_id, planned_start);
CREATE INDEX idx_orders_parent ON orders(parent_order_id);
CREATE INDEX idx_order_delays_order ON order_delays(order_id);
CREATE INDEX idx_allocations_order ON machine_allocations(order_id);
CREATE INDEX idx_allocations_operator ON machine_allocations(operator_id);
CREATE INDEX idx_actions_allocation ON operator_actions(allocation_id);
CREATE INDEX idx_results_order ON production_results(order_id);
CREATE INDEX idx_bom_positions_bom ON bom_positions(bom_id);
CREATE INDEX idx_boms_parent_item ON boms(parent_item_id);
CREATE INDEX idx_stock_tx_item ON stock_transactions(company_id, item_id);
CREATE INDEX idx_stock_tx_lot ON stock_transactions(lot_id);
CREATE INDEX idx_items_company ON items(company_id);
CREATE INDEX idx_audit_company_time ON audit_logs(company_id, timestamp);

-- ─── Same-company references ────────────────────────────────────────────────
-- Turn every reference between business tables into a composite
-- (x_id, company_id) -> (id, company_id) foreign key, so a record can never
-- point at a record of another company (foreign-key checks ignore row-level
-- security, so this has to be enforced separately).

DO $$
DECLARE
  t text;
  r record;
  on_delete text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped
    WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
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
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = con.conrelid AND x.attname = 'company_id' AND NOT x.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = con.confrelid AND x.attname = 'company_id' AND NOT x.attisdropped)
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
END $$;

-- ─── Row-level security ─────────────────────────────────────────────────────

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY company_self ON companies
  USING (nova_is_system() OR id = nova_company_id())
  WITH CHECK (nova_is_system());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','shifts','shift_members','areas','machines','operator_schedules',
    'items','item_routes','requirements','boms','bom_positions',
    'orders','delay_reasons','order_delays',
    'machine_allocations','operator_actions','production_results','defect_reasons','defect_logs',
    'shift_reports','report_issues','audit_logs',
    'stock_levels','inventory_lots','stock_transactions','order_material_lots','order_material_allocations','purchase_recommendations',
    'machine_maintenance_config','maintenance_logs','operator_skills',
    'suppliers','item_suppliers','warehouses','warehouse_locations',
    'purchase_orders','purchase_order_items','goods_receipts','goods_receipt_items',
    'quarantine_logs','stock_transfers','stock_transfer_items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (nova_is_system() OR company_id = nova_company_id()) WITH CHECK (nova_is_system() OR company_id = nova_company_id())',
      t
    );
  END LOOP;
END $$;
