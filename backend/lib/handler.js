/**
 * Route handler wrapper.
 *
 * h(fn) runs the whole request inside ONE database transaction scoped to the
 * logged-in user's company:
 *  - all writes of a request succeed or fail together;
 *  - if the handler responds with an error status (>= 400), changes are rolled back;
 *  - the response is sent only after the transaction is committed;
 *  - successful changes (POST/PUT/PATCH/DELETE) are written to the audit log.
 */
const db = require('../db');

const SENSITIVE_KEYS = /password|token|secret/i;

function sanitize(body) {
  if (!body || typeof body !== 'object') return body ?? null;
  return JSON.parse(JSON.stringify(body, (k, v) => (SENSITIVE_KEYS.test(k) ? '[redacted]' : v)));
}

async function writeAudit(req, payload) {
  const entity = (req.baseUrl || '').replace(/^\/api\//, '') || 'unknown';
  const idParam = Number.parseInt(req.params?.id, 10);
  const entityId = Number.isInteger(idParam) ? idParam : (Number.isInteger(payload?.id) ? payload.id : null);
  const details = JSON.stringify({ path: req.path, body: sanitize(req.body) });
  await db.run(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, new_data) VALUES (?, ?, ?, ?, ?)',
    [req.user?.id ?? null, req.method, entity, entityId, details.slice(0, 20000)],
  );
}

function h(fn) {
  return async (req, res) => {
    const originalJson = res.json.bind(res);
    let pending;
    let hasPending = false;
    res.json = (body) => { pending = body; hasPending = true; return res; };

    const ctx = {
      companyId: req.user?.company_id,
      userId: req.user?.id,
      timezone: req.user?.timezone,
    };
    try {
      await db.withContext(ctx, async () => {
        await fn(req, res);
        if (res.statusCode >= 400) throw db.rollbackWith();
        if (req.user && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
          await writeAudit(req, pending);
        }
      });
    } finally {
      res.json = originalJson;
    }
    if (hasPending) originalJson(pending);
    else if (!res.headersSent) res.end();
  };
}

module.exports = { h };
