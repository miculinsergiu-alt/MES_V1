-- Tool management (Werkzeugverwaltung): tools mounted on machines with a
-- tool life in parts, automatic usage counting from production results,
-- spare stock with minimum, replacement / regrind log.

CREATE TABLE tools (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  tool_type TEXT,                              -- e.g. Fräser, Bohrer, Wendeplatte
  machine_id INTEGER REFERENCES machines(id),  -- where it is mounted (NULL = in the tool store)
  life_limit_parts INTEGER,                    -- parts until replacement / regrind
  used_parts INTEGER NOT NULL DEFAULT 0,
  spare_count INTEGER NOT NULL DEFAULT 0,
  min_spares INTEGER NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id),
  unit_cost NUMERIC(12,2),
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT nova_now(),
  UNIQUE (company_id, code)
);

CREATE TABLE tool_events (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('replaced','regrind','mounted','unmounted','spares_added','retired')),
  used_parts_before INTEGER,
  quantity INTEGER,
  machine_id INTEGER REFERENCES machines(id),
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT nova_now()
);
CREATE INDEX tool_events_tool ON tool_events (tool_id, created_at);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tools','tool_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (nova_is_system() OR company_id = nova_company_id()) WITH CHECK (nova_is_system() OR company_id = nova_company_id())', t);
  END LOOP;
END $$;
