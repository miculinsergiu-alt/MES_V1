/**
 * Express application (without starting the HTTP server — see server.js).
 * Kept separate so tests can drive the API directly.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');
const db = require('./db');
const { errorHandler, notFound } = require('./lib/errors');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);

// Security headers incl. a content security policy: scripts only from this
// server, no inline scripts, no framing. Inline styles stay allowed (React
// style props); fonts may come from Google Fonts.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      frameSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(require('cookie-parser')());
if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins, credentials: true }));
// Uploaded e-invoices are sent as base64 JSON and may be larger.
app.use('/api/purchase-invoices', express.json({ limit: '21mb' }));
app.use('/api/import', express.json({ limit: '15mb' }));
app.use('/api/attachments', express.json({ limit: '21mb' }));
app.use(express.json({ limit: '2mb' }));

// Request log (method, path, status, duration) — never bodies, they can contain passwords.
if (!config.isTest) {
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (!req.path.startsWith('/api')) return;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms`);
    });
    next();
  });
}

// ─── API ────────────────────────────────────────────────────────────────────
// Health check used by the hosting platform: also verifies the database answers.
app.get('/api/health', async (req, res) => {
  try {
    await db.withContext({}, () => db.get('SELECT 1 AS ok'));
    res.json({ status: 'ok', version: '1.2.0' });
  } catch {
    res.status(503).json({ status: 'error', code: 'DATABASE_UNAVAILABLE' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/machines', require('./routes/machines'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/production', require('./routes/production'));
app.use('/api/shift-reports', require('./routes/shiftReports'));
app.use('/api/items', require('./routes/items'));
app.use('/api/boms', require('./routes/boms'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/oee', require('./routes/oee'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/warehousing', require('./routes/warehousing'));
app.use('/api/procurement', require('./routes/procurement'));
app.use('/api/quality', require('./routes/quality'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/datev', require('./routes/datev'));
app.use('/api/purchase-invoices', require('./routes/purchaseInvoices'));
app.use('/api/import', require('./routes/import'));
app.use('/api/setup', require('./routes/setup'));
app.use('/api/trace', require('./routes/trace'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/attachments', require('./routes/attachments'));
app.use('/api/subcontracting', require('./routes/subcontracting'));
app.use('/api/quote-calc', require('./routes/quotecalc'));
app.use('/api', require('./routes/dashboard'));

app.use('/api', (req, res, next) => next(notFound(`API route ${req.method} ${req.path}`)));

// ─── Frontend (production build) ────────────────────────────────────────────
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(frontendDist, 'index.html')));
}

app.use(errorHandler);

module.exports = app;
