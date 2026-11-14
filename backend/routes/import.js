const express = require('express');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { badRequest, forbidden } = require('../lib/errors');
const importer = require('../services/importer');
const { authenticateToken, requireRole, hasRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// Who may import what
const ROLES = {
  items: ['administrator', 'planner'],
  boms: ['administrator', 'planner'],
  customers: ['administrator', 'sales', 'accounting'],
  suppliers: ['administrator', 'planner', 'material_planner'],
  stock: ['administrator', 'planner', 'warehouse_manager'],
};
const MAX_BYTES = 10 * 1024 * 1024;

function guard(req) {
  const { type } = v.params(req, v.z.object({ type: v.z.enum(Object.keys(ROLES)) }));
  if (!hasRole(req.user, ...ROLES[type])) throw forbidden('Your role may not import this data');
  return type;
}

const uploadSchema = v.z.object({
  filename: v.z.string().trim().min(1).max(255),
  content_base64: v.z.string().min(1),
  mapping: v.z.record(v.z.string(), v.z.string()).optional(),
});

function fileOf(b) {
  const buf = Buffer.from(b.content_base64, 'base64');
  if (!buf.length) throw badRequest('The file is empty');
  if (buf.length > MAX_BYTES) throw badRequest('The file is larger than 10 MB');
  return buf;
}

// GET /api/import/:type/template — Excel template
router.get('/:type/template', h(async (req, res) => {
  const type = guard(req);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="NOVA_Import_${type}.xlsx"`);
  res.end(importer.template(type));
}));

// POST /api/import/:type/preview — validate without saving
router.post('/:type/preview', h(async (req, res) => {
  const type = guard(req);
  const b = v.body(req, uploadSchema);
  res.json(await importer.preview(type, fileOf(b), b.filename, b.mapping));
}));

// POST /api/import/:type — import (all rows or none)
router.post('/:type', h(async (req, res) => {
  const type = guard(req);
  const b = v.body(req, uploadSchema);
  res.json(await importer.commit(type, fileOf(b), b.filename, b.mapping, req.user.id));
}));

module.exports = router;
