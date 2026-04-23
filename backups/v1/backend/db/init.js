const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ─── USERS DB ──────────────────────────────────────────────────────────────
const usersDb = new Database(path.join(DB_DIR, 'users.db'));
usersDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    badge_number TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('administrator','planner','area_supervisor','shift_responsible','operator')),
    password_hash TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    shift_responsible_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS shift_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    UNIQUE(shift_id, user_id)
  );
`);

// ─── MACHINES DB ───────────────────────────────────────────────────────────
const machinesDb = new Database(path.join(DB_DIR, 'machines.db'));
machinesDb.exec(`
  CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    setup_time_min INTEGER DEFAULT 30,
    working_time_min INTEGER DEFAULT 480,
    supervision_time_min INTEGER DEFAULT 30,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── ORDERS DB ─────────────────────────────────────────────────────────────
const ordersDb = new Database(path.join(DB_DIR, 'orders.db'));
ordersDb.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    planned_start TEXT NOT NULL,
    planned_end TEXT NOT NULL,
    actual_start TEXT,
    actual_end TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','done','cancelled')),
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_delays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    delay_minutes INTEGER NOT NULL,
    reason TEXT,
    reported_by INTEGER,
    source TEXT CHECK(source IN ('operator','shift_responsible','system')),
    applied INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── PRODUCTION DB ─────────────────────────────────────────────────────────
const productionDb = new Database(path.join(DB_DIR, 'production.db'));
productionDb.exec(`
  CREATE TABLE IF NOT EXISTS machine_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    operator_id INTEGER NOT NULL,
    machine_id INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    phase TEXT CHECK(phase IN ('setup','working','supervision')),
    delay_confirmed INTEGER DEFAULT 0,
    delay_minutes INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS operator_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    allocation_id INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('setup_start','setup_end','working_start','working_end','supervision_start','supervision_end','delay_start','delay_end')),
    timestamp TEXT DEFAULT (datetime('now')),
    notes TEXT
  );
  CREATE TABLE IF NOT EXISTS production_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    operator_id INTEGER,
    qty_ok INTEGER DEFAULT 0,
    qty_fail INTEGER DEFAULT 0,
    completed_at TEXT DEFAULT (datetime('now'))
  );
`);

// Moved to productionDb where they belong
productionDb.exec(`
  CREATE TABLE IF NOT EXISTS defect_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT DEFAULT 'general'
  );
  CREATE TABLE IF NOT EXISTS defect_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result_id INTEGER NOT NULL,
    reason_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── SHIFT REPORTS DB ──────────────────────────────────────────────────────
const shiftReportsDb = new Database(path.join(DB_DIR, 'shift_reports.db'));
shiftReportsDb.exec(`
  CREATE TABLE IF NOT EXISTS shift_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL,
    shift_responsible_id INTEGER NOT NULL,
    report_date TEXT NOT NULL,
    general_notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS report_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    machine_id INTEGER,
    order_id INTEGER,
    description TEXT NOT NULL,
    delay_minutes INTEGER DEFAULT 0,
    delay_already_logged INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── SEED DATA ─────────────────────────────────────────────────────────────
function seedIfNeeded() {
  const admin = usersDb.prepare('SELECT id FROM users WHERE badge_number = ?').get('ADMIN001');
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    usersDb.prepare(`
      INSERT INTO users (first_name, last_name, badge_number, role, password_hash)
      VALUES (?, ?, ?, ?, ?)
    `).run('Admin', 'System', 'ADMIN001', 'administrator', hash);
    console.log('✅ Seed: Admin creat (badge: ADMIN001, parolă: admin123)');
  }

  // Demo area + machine
  const area = machinesDb.prepare('SELECT id FROM areas WHERE name = ?').get('Aria Demo');
  if (!area) {
    const areaRes = machinesDb.prepare('INSERT INTO areas (name, description) VALUES (?, ?)').run('Aria Demo', 'Arie de producție demonstrativă');
    machinesDb.prepare('INSERT INTO machines (area_id, name, setup_time_min, working_time_min, supervision_time_min) VALUES (?,?,?,?,?)').run(areaRes.lastInsertRowid, 'Utilaj 1', 30, 480, 20);
    machinesDb.prepare('INSERT INTO machines (area_id, name, setup_time_min, working_time_min, supervision_time_min) VALUES (?,?,?,?,?)').run(areaRes.lastInsertRowid, 'Utilaj 2', 45, 360, 30);
    console.log('✅ Seed: Arie Demo + 2 utilaje create');
  }

  // Demo users
  const planner = usersDb.prepare('SELECT id FROM users WHERE badge_number = ?').get('PLN001');
  if (!planner) {
    const roles = [
      ['Mihai', 'Ionescu', 'PLN001', 'planner'],
      ['Elena', 'Popescu', 'SPV001', 'area_supervisor'],
      ['Andrei', 'Dumitrescu', 'SHR001', 'shift_responsible'],
      ['Ion', 'Constantin', 'OPR001', 'operator'],
      ['Maria', 'Stan', 'OPR002', 'operator'],
    ];
    const hash = bcrypt.hashSync('pass123', 10);
    for (const [fn, ln, badge, role] of roles) {
      usersDb.prepare('INSERT OR IGNORE INTO users (first_name, last_name, badge_number, role, password_hash) VALUES (?,?,?,?,?)').run(fn, ln, badge, role, hash);
    }

    // Create a demo shift
    const shiftRes = usersDb.prepare('INSERT INTO shifts (name, shift_responsible_id) VALUES (?,?)').run('Sch. A', 3);
    const shiftId = shiftRes.lastInsertRowid;
    // Add members: shift responsible (id=3 assumption) + operators
    for (let uid = 3; uid <= 5; uid++) {
      usersDb.prepare('INSERT OR IGNORE INTO shift_members (shift_id, user_id) VALUES (?,?)').run(shiftId, uid);
    }
    console.log('✅ Seed: Useri demo + Schimb A creat');
  }

  // Defect reasons
  const reasons = ['Dimensiune incorectă', 'Zgârieturi suprafață', 'Eroare material', 'Defect asamblare', 'Altele'];
  const checkReason = productionDb.prepare('SELECT id FROM defect_reasons LIMIT 1').get();
  if (!checkReason) {
    const stmt = productionDb.prepare('INSERT INTO defect_reasons (name) VALUES (?)');
    reasons.forEach(r => stmt.run(r));
    console.log('✅ Seed: Motive defecte create');
  }
}

module.exports = { usersDb, machinesDb, ordersDb, productionDb, shiftReportsDb, seedIfNeeded };
