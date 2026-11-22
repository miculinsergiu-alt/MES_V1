/**
 * Deleting items safely: an item is only deleted when nothing references it.
 * "In use" = any non-cascading foreign key to items (BOMs, orders, sales lines,
 * stock movements, …) found via pg_constraint, so new tables are covered
 * automatically, plus stock on hand / reserved. Cascading children (routing,
 * empty stock rows, supplier links, inspection plans) go with the item.
 */
const db = require('../db');

const CHUNK = 1000;

function chunks(arr, n = CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const inList = (n) => Array(n).fill('?').join(',');

async function blockingReferences() {
  // Composite keys like (company_id, item_id) -> (company_id, id): take only the
  // local column that points at items.id.
  return db.all(`
    SELECT DISTINCT c.conrelid::regclass::text AS tbl, a.attname AS col
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(local_att, ref_att)
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = k.ref_att AND ra.attname = 'id'
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.local_att
    WHERE c.contype = 'f' AND c.confrelid = 'items'::regclass AND c.confdeltype <> 'c'`);
}

/** Map item id -> reason it cannot be deleted. */
async function findBlocked(ids) {
  const blocked = new Map();
  const refs = await blockingReferences();
  for (const part of chunks(ids)) {
    for (const { tbl, col } of refs) {
      const rows = await db.all(`SELECT DISTINCT ${col} AS ref_id FROM ${tbl} WHERE ${col} IN (${inList(part.length)})`, part);
      for (const r of rows) if (!blocked.has(r.ref_id)) blocked.set(r.ref_id, `used in ${tbl}`);
    }
    const stock = await db.all(`
      SELECT item_id AS ref_id FROM stock_levels WHERE item_id IN (${inList(part.length)}) AND (COALESCE(quantity, 0) <> 0 OR COALESCE(allocated_quantity, 0) <> 0)
      UNION
      SELECT item_id AS ref_id FROM inventory_lots WHERE item_id IN (${inList(part.length)}) AND COALESCE(quantity, 0) <> 0`, [...part, ...part]);
    for (const r of stock) if (!blocked.has(r.ref_id)) blocked.set(r.ref_id, 'has stock');
  }
  return blocked;
}

/**
 * Deletes the given items (ids or item codes) of the current company.
 * Returns { deleted, not_found, blocked: [{ id, item_code, reason }] }.
 */
async function deleteItems({ ids = [], itemCodes = [] }) {
  const found = [];
  for (const part of chunks([...new Set(ids)])) {
    found.push(...await db.all(`SELECT id, item_code FROM items WHERE id IN (${inList(part.length)})`, part));
  }
  for (const part of chunks([...new Set(itemCodes)])) {
    found.push(...await db.all(`SELECT id, item_code FROM items WHERE item_code IN (${inList(part.length)})`, part));
  }
  const byId = new Map(found.map((r) => [r.id, r]));
  const requested = new Set(ids).size + new Set(itemCodes).size;
  const blocked = await findBlocked([...byId.keys()]);
  const deletable = [...byId.keys()].filter((id) => !blocked.has(id));
  for (const part of chunks(deletable)) {
    await db.run(`DELETE FROM attachments WHERE owner_type = 'item' AND owner_id IN (${inList(part.length)})`, part);
    await db.run(`DELETE FROM items WHERE id IN (${inList(part.length)})`, part);
  }
  return {
    deleted: deletable.length,
    not_found: Math.max(0, requested - byId.size),
    blocked: [...blocked].map(([id, reason]) => ({ id, item_code: byId.get(id)?.item_code, reason })),
  };
}

module.exports = { deleteItems, findBlocked };
