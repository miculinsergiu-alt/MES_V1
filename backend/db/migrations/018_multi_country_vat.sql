-- Invoicing from any EU country or the UK: VAT rates per seller country
-- (items may carry any rate from 0 to 30 %) and the document language (de/en).

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_tax_rate_check;
ALTER TABLE items ADD CONSTRAINT items_tax_rate_check CHECK (tax_rate >= 0 AND tax_rate <= 30);

-- Language of the documents sent to this customer; NULL = derived from the country.
ALTER TABLE customers ADD COLUMN language TEXT CHECK (language IN ('de','en'));

ALTER TABLE sales_documents ADD COLUMN language TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de','en'));
