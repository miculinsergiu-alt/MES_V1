/**
 * Input validation helpers built on zod.
 *
 * Forms send numbers as strings and empty fields as '' — the helpers below
 * accept both and normalise them, so existing screens keep working.
 */
const { z } = require('zod');
const { badRequest } = require('./errors');

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);

const MAX_INT = 2147483647; // PostgreSQL INTEGER
const id = z.coerce.number().int().positive().max(MAX_INT);
const optId = z.preprocess(emptyToNull, z.coerce.number().int().positive().max(MAX_INT).nullable()).optional();
const num = z.coerce.number().finite();
const optNum = z.preprocess(emptyToNull, z.coerce.number().finite().nullable()).optional();
const nonNeg = z.coerce.number().finite().min(0);
const posNum = z.coerce.number().finite().positive();
const int = z.coerce.number().int();
const str = (max = 500) => z.string().trim().min(1).max(max);
const optStr = (max = 2000) => z.preprocess((v) => (v === null || v === undefined ? v : String(v)), z.string().max(max).nullable().optional());
const flag = z.preprocess((v) => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : v === false || v === 'false' || v === 0 || v === '0' ? 0 : v), z.union([z.literal(0), z.literal(1)]));

// 'YYYY-MM-DD'
const isRealDate = (v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date YYYY-MM-DD').refine(isRealDate, 'Not a valid calendar date');
const optDate = z.preprocess(emptyToNull, date.nullable()).optional();

// Accepts 'YYYY-MM-DD HH:MM[:SS]' or 'YYYY-MM-DDTHH:MM[:SS][.sss][Z]' and
// normalises to local 'YYYY-MM-DD HH:MM:SS' (the format stored in the DB).
const dateTime = z.string().trim().transform((v, ctx) => {
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    ctx.addIssue({ code: 'custom', message: 'Expected date-time YYYY-MM-DD HH:MM' });
    return z.NEVER;
  }
  return `${m[1]} ${m[2]}:${m[3]}:${m[4] || '00'}`;
});
const optDateTime = z.preprocess(emptyToNull, dateTime.nullable()).optional();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected time HH:MM (00:00-23:59)');

function formatIssues(error) {
  return error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message }));
}

/** Parses data with schema or throws a 400 with field-level details. */
function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const issues = formatIssues(r.error);
    const first = issues[0];
    throw badRequest(first?.field ? `Invalid ${first.field}: ${first.message}` : (first?.message || 'Invalid input'), issues);
  }
  return r.data;
}

const body = (req, schema) => parse(schema, req.body);
const query = (req, schema) => parse(schema, req.query);
const params = (req, schema) => parse(schema, req.params);
const paramId = (req, name = 'id') => parse(z.object({ [name]: id }), req.params)[name];

module.exports = {
  z, parse, body, query, params, paramId,
  id, optId, num, optNum, nonNeg, posNum, int, str, optStr, flag, date, optDate, dateTime, optDateTime, time,
};
