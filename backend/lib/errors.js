/**
 * Application errors with an HTTP status and a stable machine-readable code.
 * The frontend can translate `code`; `error` is a readable English fallback.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (message) => new AppError(409, 'CONFLICT', message);
const forbidden = (message = 'Access denied for your role') => new AppError(403, 'FORBIDDEN', message);
const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);

/** Maps PostgreSQL error codes to friendly HTTP errors. */
function fromDatabaseError(err) {
  switch (err.code) {
    case '23505': return new AppError(409, 'DUPLICATE', 'A record with this value already exists', { constraint: err.constraint });
    case '23503': return new AppError(400, 'INVALID_REFERENCE', 'A referenced record does not exist or is still in use', { constraint: err.constraint });
    case '23502': return new AppError(400, 'MISSING_FIELD', `Missing required value${err.column ? `: ${err.column}` : ''}`);
    case '23514': return new AppError(400, 'INVALID_VALUE', 'A value is not allowed', { constraint: err.constraint });
    case '22P02':
    case '22007':
    case '22008': return new AppError(400, 'INVALID_FORMAT', 'A value has an invalid format');
    case '42501': return new AppError(403, 'FORBIDDEN', 'Access denied');
    default: return null;
  }
}

/** Express error handler: consistent JSON errors, no internal details leaked. */
function errorHandler(err, req, res, _next) {
  let e = err instanceof AppError ? err : fromDatabaseError(err);
  if (!e && err.type === 'entity.parse.failed') e = badRequest('Request body is not valid JSON');
  if (!e && err.type === 'entity.too.large') e = new AppError(413, 'TOO_LARGE', 'Request body too large');
  if (!e) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
    e = new AppError(500, 'INTERNAL', 'Internal server error');
  }
  if (res.headersSent) return;
  let body = { error: e.message, code: e.code };
  if (Array.isArray(e.details)) body.details = e.details;
  else if (e.details && typeof e.details === 'object') body = { ...e.details, ...body };
  res.status(e.status).json(body);
}

module.exports = { AppError, badRequest, notFound, conflict, forbidden, unauthorized, fromDatabaseError, errorHandler };
