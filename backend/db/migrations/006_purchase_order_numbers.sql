-- Purchase orders get their own number per company and year (BE-2026-00001, "Bestellung"),
-- like quotes and invoices, instead of showing the internal database id.

ALTER TABLE number_series DROP CONSTRAINT number_series_doc_type_check;
ALTER TABLE number_series ADD CONSTRAINT number_series_doc_type_check
  CHECK (doc_type IN ('quote','order','delivery','invoice','credit_note','customer','dunning','purchase_order'));

ALTER TABLE purchase_orders ADD COLUMN po_number TEXT;

-- Number the existing purchase orders per company and year, in the order they were created.
WITH numbered AS (
  SELECT id,
         COALESCE(NULLIF(substr(order_date, 1, 4), ''), to_char(now(), 'YYYY')) AS yr,
         row_number() OVER (PARTITION BY company_id, COALESCE(NULLIF(substr(order_date, 1, 4), ''), to_char(now(), 'YYYY')) ORDER BY id) AS n
  FROM purchase_orders
)
UPDATE purchase_orders po
SET po_number = 'BE-' || numbered.yr || '-' || lpad(numbered.n::text, 5, '0')
FROM numbered WHERE numbered.id = po.id;

-- Continue each company's series after the last number used in its latest year.
INSERT INTO number_series (company_id, doc_type, prefix, yearly_reset, digits, year, next_number)
SELECT company_id, 'purchase_order', 'BE', 1, 5, max_year::int,
       (SELECT count(*) FROM purchase_orders p2
         WHERE p2.company_id = s.company_id AND substr(p2.po_number, 4, 4) = s.max_year) + 1
FROM (SELECT company_id, max(substr(po_number, 4, 4)) AS max_year FROM purchase_orders GROUP BY company_id) s
ON CONFLICT (company_id, doc_type) DO NOTHING;

ALTER TABLE purchase_orders ALTER COLUMN po_number SET NOT NULL;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_number_unique UNIQUE (company_id, po_number);
