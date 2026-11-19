-- Customer-supplied material (Beistellmaterial): belongs to the customer, is
-- received without purchase price, has no stock value, and may only be used
-- for that customer's orders.

ALTER TABLE inventory_lots ADD COLUMN owner_customer_id INTEGER REFERENCES customers(id);
ALTER TABLE goods_receipts ADD COLUMN customer_id INTEGER REFERENCES customers(id);
CREATE INDEX inventory_lots_owner ON inventory_lots (company_id, owner_customer_id) WHERE owner_customer_id IS NOT NULL;
