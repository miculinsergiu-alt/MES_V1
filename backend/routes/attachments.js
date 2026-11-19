/**
 * Attachments: files on lots, items, orders, goods receipts, complaints …
 * Upload as base64 JSON (like incoming e-invoices). Drawings and NC programs
 * carry a revision index; a new revision replaces the current one but the
 * old ones stay available (history).
 */
const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const { h } = require('../lib/handler');
const v = require('../lib/validate');
const { notFound, badRequest, forbidden } = require('../lib/errors');
const { authenticateToken, hasRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

const OWNER_TABLES = {
  lot: 'inventory_lots', item: 'items', order: 'orders', receipt: 'goods_receipts',
  complaint: 'complaints', customer: 'customers', supplier: 'suppliers', project: 'projects',
};
const KINDS = ['certificate', 'drawing', 'nc_program', 'report', 'photo', 'other'];
const REVISIONED = new Set(['drawing', 'nc_program']);
const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain|application\/octet-stream|application\/zip|application\/(x-)?step|model\/step|application\/dxf|image\/vnd\.dxf)$/;

// Operators may read (drawings at the machine) but not change attachments.
const WRITERS = ['administrator', 'planner', 'area_supervisor', 'shift_responsible', 'warehouse_manager', 'material_planner', 'sales', 'accounting'];
const canWrite = (user) => hasRole(user, ...WRITERS);

async function ownerExists(type, id) {
  const table = OWNER_TABLES[type];
  const exists = await db.get(`SELECT to_regclass('public.${table}') IS NOT NULL AS ok`);
  if (!exists.ok) return false;
  return !!(await db.get(`SELECT id FROM ${table} WHERE id = ?`, [id]));
}

const META_COLUMNS = 'id, owner_type, owner_id, kind, filename, mime_type, size_bytes, sha256, revision, is_current, cert_type, heat_number, notes, uploaded_by, created_at';

const listSchema = v.z.object({
  owner_type: v.z.enum(Object.keys(OWNER_TABLES)),
  owner_id: v.z.coerce.number().int().positive(),
  kind: v.z.enum(KINDS).optional(),
  all_revisions: v.z.coerce.boolean().optional(),
});

// GET /api/attachments?owner_type=lot&owner_id=5[&kind=certificate][&all_revisions=1]
router.get('/', h(async (req, res) => {
  const q = v.query(req, listSchema);
  res.json(await db.all(
    `SELECT ${META_COLUMNS} FROM attachments
     WHERE owner_type = ? AND owner_id = ? AND (?::text IS NULL OR kind = ?) AND (? OR is_current = 1)
     ORDER BY kind, is_current DESC, created_at DESC, id DESC`,
    [q.owner_type, q.owner_id, q.kind ?? null, q.kind ?? null, !!q.all_revisions],
  ));
}));

const uploadSchema = v.z.object({
  owner_type: v.z.enum(Object.keys(OWNER_TABLES)),
  owner_id: v.z.coerce.number().int().positive(),
  kind: v.z.enum(KINDS),
  filename: v.z.string().trim().min(1).max(255),
  mime_type: v.z.string().trim().max(100).optional(),
  content_base64: v.z.string().min(4),
  revision: v.z.string().trim().max(20).optional(),
  cert_type: v.z.enum(['2.1', '2.2', '3.1', '3.2']).optional(),
  heat_number: v.z.string().trim().max(100).optional(),
  notes: v.z.string().trim().max(1000).optional(),
});

function guessMime(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    txt: 'text/plain', nc: 'text/plain', h: 'text/plain', mpf: 'text/plain', spf: 'text/plain', iso: 'text/plain', tap: 'text/plain', gcode: 'text/plain',
    zip: 'application/zip', step: 'application/step', stp: 'application/step', dxf: 'application/dxf' }[ext] || 'application/octet-stream';
}

/** Checks the file type from its first bytes so a renamed file cannot pretend to be a PDF or image. */
function sniff(buf, mime) {
  const starts = (s) => buf.subarray(0, s.length).equals(Buffer.from(s));
  if (mime === 'application/pdf') return starts('%PDF');
  if (mime === 'image/png') return starts('\x89PNG');
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (mime === 'image/gif') return starts('GIF8');
  if (mime === 'image/webp') return buf.subarray(8, 12).toString() === 'WEBP';
  return true;
}

// POST /api/attachments
router.post('/', h(async (req, res) => {
  if (!canWrite(req.user)) throw forbidden();
  const b = v.body(req, uploadSchema);
  if (!(await ownerExists(b.owner_type, b.owner_id))) throw notFound('Record');
  const content = Buffer.from(b.content_base64, 'base64');
  if (!content.length) throw badRequest('Empty file');
  if (content.length > MAX_BYTES) throw badRequest('File larger than 15 MB');
  const mime = b.mime_type && b.mime_type !== 'application/octet-stream' ? b.mime_type : guessMime(b.filename);
  if (!ALLOWED_MIME.test(mime)) throw badRequest(`File type ${mime} is not allowed`);
  if (!sniff(content, mime)) throw badRequest('The file content does not match its type');
  if (b.kind === 'certificate' && !b.cert_type) b.cert_type = '3.1';

  if (REVISIONED.has(b.kind)) {
    if (!b.revision) throw badRequest('Revision index is required for drawings and NC programs');
    const dup = await db.get(
      'SELECT id FROM attachments WHERE owner_type = ? AND owner_id = ? AND kind = ? AND revision = ?',
      [b.owner_type, b.owner_id, b.kind, b.revision],
    );
    if (dup) throw badRequest(`Revision ${b.revision} already exists`);
    await db.run('UPDATE attachments SET is_current = 0 WHERE owner_type = ? AND owner_id = ? AND kind = ?', [b.owner_type, b.owner_id, b.kind]);
  }
  const row = await db.get(
    `INSERT INTO attachments (owner_type, owner_id, kind, filename, mime_type, size_bytes, content, sha256, revision, cert_type, heat_number, notes, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING ${META_COLUMNS}`,
    [b.owner_type, b.owner_id, b.kind, b.filename, mime, content.length, content,
      crypto.createHash('sha256').update(content).digest('hex'),
      REVISIONED.has(b.kind) ? b.revision : (b.revision || null),
      b.kind === 'certificate' ? b.cert_type : null, b.heat_number || null, b.notes || null, req.user.id],
  );
  res.status(201).json(row);
}));

// GET /api/attachments/:id/file — download (inline for PDF/images)
router.get('/:id/file', h(async (req, res) => {
  const { id } = v.params(req, v.z.object({ id: v.z.coerce.number().int().positive() }));
  const f = await db.get('SELECT filename, mime_type, content FROM attachments WHERE id = ?', [id]);
  if (!f) throw notFound('File');
  const inline = /^(application\/pdf|image\/)/.test(f.mime_type);
  res.setHeader('Content-Type', f.mime_type);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(f.content));
}));

// DELETE /api/attachments/:id — wrong upload; the previous revision becomes current again
router.delete('/:id', h(async (req, res) => {
  if (!canWrite(req.user)) throw forbidden();
  const { id } = v.params(req, v.z.object({ id: v.z.coerce.number().int().positive() }));
  const a = await db.get('SELECT id, owner_type, owner_id, kind, is_current FROM attachments WHERE id = ?', [id]);
  if (!a) throw notFound('File');
  if (a.kind === 'drawing' || a.kind === 'nc_program') {
    const used = await db.get('SELECT id FROM orders WHERE drawing_attachment_id = ? OR nc_attachment_id = ? LIMIT 1', [id, id]);
    if (used) throw badRequest('This revision is referenced by a production order and cannot be deleted');
  }
  await db.run('DELETE FROM attachments WHERE id = ?', [id]);
  if (a.is_current && REVISIONED.has(a.kind)) {
    await db.run(
      `UPDATE attachments SET is_current = 1 WHERE id = (
         SELECT id FROM attachments WHERE owner_type = ? AND owner_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1)`,
      [a.owner_type, a.owner_id, a.kind],
    );
  }
  res.json({ ok: true });
}));

module.exports = router;
module.exports.META_COLUMNS = META_COLUMNS;
