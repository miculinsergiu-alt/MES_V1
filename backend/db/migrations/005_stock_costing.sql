-- Phase 3: stock rules, production batches, costing data, multiple roles.

-- What happens when an issue would make stock negative:
--   allow = book it (stock goes negative), warn = book it and flag it, block = refuse.
ALTER TABLE companies ADD COLUMN negative_stock TEXT NOT NULL DEFAULT 'warn' CHECK (negative_stock IN ('allow','warn','block'));

-- Costing
ALTER TABLE companies ADD COLUMN labor_rate NUMERIC(10,2) NOT NULL DEFAULT 0;      -- € per hour, default for all operators
ALTER TABLE machines ADD COLUMN hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0;      -- € per machine hour
ALTER TABLE items ADD COLUMN avg_cost NUMERIC(14,4) NOT NULL DEFAULT 0;            -- moving average purchase / production cost

-- Production batches: which order produced a lot (for finished and semi-finished goods)
ALTER TABLE inventory_lots ADD COLUMN source_type TEXT NOT NULL DEFAULT 'receipt' CHECK (source_type IN ('receipt','production','import','adjustment'));
ALTER TABLE inventory_lots ADD COLUMN production_order_id INTEGER;
ALTER TABLE inventory_lots ADD CONSTRAINT inventory_lots_production_order_fkey
  FOREIGN KEY (production_order_id, company_id) REFERENCES orders(id, company_id) ON DELETE SET NULL (production_order_id);

-- Unit cost at the time of each stock movement (for stock value and actual costs)
ALTER TABLE stock_transactions ADD COLUMN unit_cost NUMERIC(14,4);

-- Users may have several roles (e.g. the owner is planner, sales and accounting).
-- "role" stays the primary role; "roles" holds all of them.
ALTER TABLE users ADD COLUMN roles TEXT[];
UPDATE users SET roles = ARRAY[role] WHERE roles IS NULL;

-- Keep "roles" consistent: filled from "role" if not given, and always containing the primary role.
CREATE OR REPLACE FUNCTION nova_sync_user_roles() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.roles IS NULL OR cardinality(NEW.roles) = 0 THEN
    NEW.roles := ARRAY[NEW.role];
  ELSIF NOT (NEW.role = ANY(NEW.roles)) THEN
    NEW.roles := array_prepend(NEW.role, NEW.roles);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sync_user_roles BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION nova_sync_user_roles();
ALTER TABLE users ALTER COLUMN roles SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_roles_valid CHECK (
  roles <@ ARRAY['administrator','planner','area_supervisor','shift_responsible','operator','warehouse_manager','material_planner','sales','accounting']::text[]
  AND cardinality(roles) >= 1 AND role = ANY(roles));

CREATE INDEX idx_order_material_lots_lot ON order_material_lots(lot_id);
CREATE INDEX idx_order_material_lots_order ON order_material_lots(order_id);
CREATE INDEX idx_inventory_lots_production ON inventory_lots(production_order_id);
CREATE INDEX idx_stock_tx_reference ON stock_transactions(company_id, reference_type, reference_id);
