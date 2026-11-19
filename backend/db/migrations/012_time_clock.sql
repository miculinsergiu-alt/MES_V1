-- Time recording (Arbeitszeiterfassung / PZE): clock in / clock out per
-- employee, with breaks. German employers must record working time.

ALTER TABLE companies ADD COLUMN daily_target_hours NUMERIC(4,2) NOT NULL DEFAULT 8;

CREATE TABLE time_entries (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  clock_in TEXT NOT NULL,                 -- local time of the company
  clock_out TEXT,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  break_started TEXT,                     -- running break
  source TEXT NOT NULL DEFAULT 'terminal' CHECK (source IN ('terminal','correction')),
  note TEXT,
  corrected_by INTEGER REFERENCES users(id),
  corrected_at TEXT,
  created_at TEXT DEFAULT nova_now()
);
CREATE INDEX time_entries_user ON time_entries (company_id, user_id, clock_in);
-- At most one open entry per employee.
CREATE UNIQUE INDEX time_entries_one_open ON time_entries (user_id) WHERE clock_out IS NULL;

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON time_entries
  USING (nova_is_system() OR company_id = nova_company_id())
  WITH CHECK (nova_is_system() OR company_id = nova_company_id());
