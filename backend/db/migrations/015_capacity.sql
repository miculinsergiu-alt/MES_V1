-- Capacity per machine: available hours per week (e.g. 40 for one shift,
-- 80 for two shifts). Used for the load chart and the delivery date check.
ALTER TABLE machines ADD COLUMN weekly_hours NUMERIC(6,2) NOT NULL DEFAULT 40;
