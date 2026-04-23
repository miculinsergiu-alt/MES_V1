const { db } = require('../db/init');

/**
 * Middleware to audit log all mutating requests (POST, PUT, DELETE).
 * It attempts to capture the state before and after the change.
 */
const auditMiddleware = (req, res, next) => {
  // Only log mutating methods
  if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
    return next();
  }

  // Skip audit logging for specific routes if necessary (e.g., auth)
  if (req.path.includes('/api/auth/login')) {
    return next();
  }

  const user_id = req.user ? req.user.id : null;
  const action = req.method;
  const pathParts = req.path.split('/');
  const entity = pathParts[2]; // assuming /api/ENTITY/...
  const entity_id = pathParts[3] && !isNaN(pathParts[3]) ? parseInt(pathParts[3]) : null;

  // We'll capture the old data only for PUT and DELETE
  let oldData = null;
  if (['PUT', 'DELETE'].includes(req.method) && entity && entity_id) {
    try {
      // Very basic generic fetch - might need tuning per entity
      const stmt = db.prepare(`SELECT * FROM ${entity} WHERE id = ?`);
      oldData = stmt.get(entity_id);
    } catch (e) {
      // Table might not exist or ID might not be the PK
    }
  }

  // Intercept the finish event to log the new data for POST/PUT
  const originalJson = res.json;
  res.json = function (data) {
    res.json = originalJson;
    
    // Log after the response is sent/ready
    process.nextTick(() => {
      let finalEntityId = entity_id || (data && data.id);
      
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        user_id,
        action,
        entity || 'unknown',
        finalEntityId || null,
        oldData ? JSON.stringify(oldData) : null,
        data ? JSON.stringify(data) : null
      );
    });

    return res.json(data);
  };

  next();
};

module.exports = auditMiddleware;
