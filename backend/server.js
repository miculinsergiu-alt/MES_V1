// env defaults (override via system environment variables)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smartfactory_secret_key_2024';
process.env.PORT = process.env.PORT || '3001';

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { seedIfNeeded } = require('./db/init');
const { initSocket } = require('./services/socket');
const auditMiddleware = require('./middleware/audit');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const machinesRoutes = require('./routes/machines');
const ordersRoutes = require('./routes/orders');
const productionRoutes = require('./routes/production');
const shiftReportsRoutes = require('./routes/shiftReports');
const itemsRoutes = require('./routes/items');
const bomsRoutes = require('./routes/boms');
const stockRoutes = require('./routes/stock');
const maintenanceRoutes = require('./routes/maintenance');
const analyticsRoutes = require('./routes/analytics');

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// ─── Socket.io ──────────────────────────────────────────────────────────────
initSocket(httpServer);

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Request logger with response time
app.use((req, res, next) => {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const time = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${time}ms)`);
  });

  next();
});

// Audit Middleware
app.use(auditMiddleware);

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/machines', machinesRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/shift-reports', shiftReportsRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/boms', bomsRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/analytics', analyticsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: '1.1.0' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} nu a fost găsită` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Eroare internă de server' });
});

// ─── Start ──────────────────────────────────────────────────────────────────
seedIfNeeded();
httpServer.listen(PORT, () => {
  console.log(`\n🚀 SmartFactory MES Backend pornit pe http://localhost:${PORT}`);
  console.log(`📋 API disponibil la http://localhost:${PORT}/api`);
  console.log(`\n👤 Credențiale demo:`);
  console.log(`   Admin     → ADMIN001 / admin123`);
  console.log(`   Planner   → PLN001   / pass123`);
  console.log(`   Supervisor→ SPV001   / pass123`);
  console.log(`   Sh.Resp.  → SHR001   / pass123`);
  console.log(`   Operator  → OPR001   / pass123\n`);
});

module.exports = httpServer;
