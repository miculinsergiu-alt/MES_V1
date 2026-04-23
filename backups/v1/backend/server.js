// env defaults (override via system environment variables)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smartfactory_secret_key_2024';
process.env.PORT = process.env.PORT || '3001';
const express = require('express');
const cors = require('cors');
const { seedIfNeeded } = require('./db/init');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const machinesRoutes = require('./routes/machines');
const ordersRoutes = require('./routes/orders');
const productionRoutes = require('./routes/production');
const shiftReportsRoutes = require('./routes/shiftReports');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/machines', machinesRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/shift-reports', shiftReportsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: '1.0.0' });
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
app.listen(PORT, () => {
  console.log(`\n🚀 SmartFactory MES Backend pornit pe http://localhost:${PORT}`);
  console.log(`📋 API disponibil la http://localhost:${PORT}/api`);
  console.log(`\n👤 Credențiale demo:`);
  console.log(`   Admin     → ADMIN001 / admin123`);
  console.log(`   Planner   → PLN001   / pass123`);
  console.log(`   Supervisor→ SPV001   / pass123`);
  console.log(`   Sh.Resp.  → SHR001   / pass123`);
  console.log(`   Operator  → OPR001   / pass123\n`);
});

module.exports = app;
