// env defaults (override via system environment variables)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smartfactory_secret_key_2024';
process.env.PORT = process.env.PORT || '3001';

const express = require('express');
const cors = require('cors');
const path = require('path');
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
const oeeRoutes = require('./routes/oee');
const shiftsRoutes = require('./routes/shifts');
const suppliersRoutes = require('./routes/suppliers');
const warehousingRoutes = require('./routes/warehousing');
const procurementRoutes = require('./routes/procurement');
const qualityRoutes = require('./routes/quality');
const inventoryRoutes = require('./routes/inventory');

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;

// ─── Socket.io ──────────────────────────────────────────────────────────────
initSocket(httpServer);

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
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
app.use('/api/oee', oeeRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/warehousing', warehousingRoutes);
app.use('/api/procurement', procurementRoutes);
app.use('/api/quality', qualityRoutes);
app.use('/api/inventory', inventoryRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: '1.1.0' });
});

// API 404 handler
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Ruta API ${req.method} ${req.path} nu a fost găsită` });
});

// ─── Frontend Serving (Production) ──────────────────────────────────────────
const frontendDistPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath));

// Fallback for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
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
