const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// Unified Database
const db = new Database(path.join(DB_DIR, 'smartfactory.db'));
db.pragma('foreign_keys = ON');

// ─── CORE SCHEMA ────────────────────────────────────────────────────────────
db.exec(`
  -- USERS
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
    shift_responsible_id INTEGER REFERENCES users(id),
    start_time TEXT, -- e.g. "06:00"
    end_time TEXT,   -- e.g. "14:00"
    created_at TEXT DEFAULT (datetime('now'))
  );
  
  CREATE TABLE IF NOT EXISTS shift_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(shift_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS operator_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    work_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, work_date, shift_id)
  );

  -- MACHINES & AREAS
  CREATE TABLE IF NOT EXISTS areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  
  CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area_id INTEGER NOT NULL REFERENCES areas(id),
    name TEXT NOT NULL,
    setup_time_min INTEGER DEFAULT 30,
    working_time_min INTEGER DEFAULT 480,
    supervision_time_min INTEGER DEFAULT 30,
    total_running_hours REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ITEMS & BOM
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('raw_material','semi_finished','finished_good')),
    uom TEXT DEFAULT 'buc',
    acquisition_cost REAL DEFAULT 0,
    production_cost REAL DEFAULT 0,
    production_time_min INTEGER DEFAULT 0,
    sop_url TEXT,
    drawing_url TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  
  CREATE TABLE IF NOT EXISTS item_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    sequence INTEGER NOT NULL,
    process_time_min INTEGER DEFAULT 0,
    notes TEXT
  );
  
  CREATE TABLE IF NOT EXISTS requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
  );
  
  CREATE TABLE IF NOT EXISTS boms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_item_id INTEGER REFERENCES items(id),
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  
  CREATE TABLE IF NOT EXISTS bom_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bom_id INTEGER NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id),
    position_code TEXT NOT NULL,
    quantity REAL NOT NULL,
    start_date TEXT,
    finish_date TEXT,
    location TEXT,
    requirement_id INTEGER REFERENCES requirements(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ORDERS
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    product_name TEXT NOT NULL,
    item_id INTEGER REFERENCES items(id),
    bom_id INTEGER REFERENCES boms(id),
    quantity INTEGER NOT NULL,
    planned_start TEXT NOT NULL,
    planned_end TEXT NOT NULL,
    actual_start TEXT,
    actual_end TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','done','cancelled')),
    order_type TEXT DEFAULT 'production' CHECK(order_type IN ('production','maintenance')),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );
  
  CREATE TABLE IF NOT EXISTS delay_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT DEFAULT 'general'
  );

  CREATE TABLE IF NOT EXISTS order_delays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    delay_minutes INTEGER NOT NULL,
    reason TEXT,
    delay_reason_id INTEGER REFERENCES delay_reasons(id),
    corrective_action TEXT,
    reported_by INTEGER REFERENCES users(id),
    source TEXT CHECK(source IN ('operator','shift_responsible','system')),
    applied INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- PRODUCTION TRACKING
  CREATE TABLE IF NOT EXISTS machine_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    operator_id INTEGER NOT NULL REFERENCES users(id),
    machine_id INTEGER NOT NULL REFERENCES machines(id),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    phase TEXT CHECK(phase IN ('setup','working','supervision')),
    delay_confirmed INTEGER DEFAULT 0,
    delay_minutes INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  
  CREATE TABLE IF NOT EXISTS operator_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    allocation_id INTEGER NOT NULL REFERENCES machine_allocations(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL CHECK(action_type IN ('setup_start','setup_end','working_start','working_end','supervision_start','supervision_end','delay_start','delay_end')),
    timestamp TEXT DEFAULT (datetime('now')),
    notes TEXT
  );
  
  CREATE TABLE IF NOT EXISTS production_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    operator_id INTEGER REFERENCES users(id),
    qty_ok INTEGER DEFAULT 0,
    qty_fail INTEGER DEFAULT 0,
    completed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS defect_reasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT DEFAULT 'general'
  );
  
  CREATE TABLE IF NOT EXISTS defect_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result_id INTEGER NOT NULL REFERENCES production_results(id) ON DELETE CASCADE,
    reason_id INTEGER NOT NULL REFERENCES defect_reasons(id),
    quantity INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- SHIFT REPORTS
  CREATE TABLE IF NOT EXISTS shift_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL REFERENCES shifts(id),
    shift_responsible_id INTEGER NOT NULL REFERENCES users(id),
    report_date TEXT NOT NULL,
    general_notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  
  CREATE TABLE IF NOT EXISTS report_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES shift_reports(id) ON DELETE CASCADE,
    machine_id INTEGER REFERENCES machines(id),
    order_id INTEGER REFERENCES orders(id),
    description TEXT NOT NULL,
    delay_minutes INTEGER DEFAULT 0,
    delay_already_logged INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- ─── ENHANCED MODULES ─────────────────────────────────────────────────────
  
  -- AUDIT LOGGING
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL, -- e.g. INSERT, UPDATE, DELETE
    entity TEXT NOT NULL, -- e.g. orders, machines
    entity_id INTEGER,
    old_data TEXT, -- JSON
    new_data TEXT, -- JSON
    timestamp TEXT DEFAULT (datetime('now'))
  );

  -- INVENTORY & LOT TRACKING
  CREATE TABLE IF NOT EXISTS stock_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    quantity REAL DEFAULT 0,
    location TEXT,
    last_updated TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS inventory_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    lot_number TEXT NOT NULL UNIQUE,
    quantity REAL DEFAULT 0,
    supplier_code TEXT,
    expiration_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stock_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id),
    lot_id INTEGER REFERENCES inventory_lots(id),
    quantity REAL NOT NULL,
    type TEXT CHECK(type IN ('in','out','adjustment')),
    reference_type TEXT, -- e.g. order, receipt
    reference_id INTEGER,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_material_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id),
    lot_id INTEGER NOT NULL REFERENCES inventory_lots(id),
    quantity_used REAL NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now'))
  );

  -- PREVENTIVE MAINTENANCE
  CREATE TABLE IF NOT EXISTS machine_maintenance_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL UNIQUE REFERENCES machines(id) ON DELETE CASCADE,
    interval_hours INTEGER NOT NULL,
    last_maintenance_hours REAL DEFAULT 0,
    warning_threshold_hours INTEGER DEFAULT 50
  );

  CREATE TABLE IF NOT EXISTS maintenance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    technician_id INTEGER REFERENCES users(id),
    maintenance_date TEXT DEFAULT (date('now')),
    hours_at_maintenance REAL NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- OPERATOR SKILLS & HR MATRIX
  CREATE TABLE IF NOT EXISTS operator_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    skill_level TEXT DEFAULT 'independent' CHECK(skill_level IN ('trainee','independent','expert')),
    expiration_date TEXT,
    UNIQUE(user_id, machine_id)
  );
`);

// ─── MIGRATIONS ─────────────────────────────────────────────────────────────
function addColumnIfNotExists(table, column, type) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some(col => col.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`✅ Migration: Column ${column} added to ${table}`);
    }
  } catch (err) {
    console.error(`❌ Migration Error (${table}.${column}):`, err.message);
  }
}

addColumnIfNotExists('shifts', 'start_time', 'TEXT');
addColumnIfNotExists('shifts', 'end_time', 'TEXT');
addColumnIfNotExists('orders', 'order_type', "TEXT DEFAULT 'production' CHECK(order_type IN ('production','maintenance'))");
addColumnIfNotExists('order_delays', 'delay_reason_id', 'INTEGER REFERENCES delay_reasons(id)');
addColumnIfNotExists('order_delays', 'corrective_action', 'TEXT');
addColumnIfNotExists('items', 'unit_price', 'REAL DEFAULT 0');

// ─── BOM MULTI-NIVEL MIGRATIONS ──────────────────────────────────────────────
addColumnIfNotExists('bom_positions', 'parent_position_id', 'INTEGER REFERENCES bom_positions(id) ON DELETE CASCADE');
addColumnIfNotExists('bom_positions', 'level', 'INTEGER DEFAULT 1');
addColumnIfNotExists('bom_positions', 'sort_order', 'INTEGER DEFAULT 0');
addColumnIfNotExists('bom_positions', 'department', 'TEXT'); // e.g. "SF02", "SF04"
addColumnIfNotExists('bom_positions', 'node_type', "TEXT DEFAULT 'component' CHECK(node_type IN ('department','component'))");

// ─── SEED DATA ─────────────────────────────────────────────────────────────
function seedIfNeeded() {
  const admin = db.prepare('SELECT id FROM users WHERE badge_number = ?').get('ADMIN001');
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (first_name, last_name, badge_number, role, password_hash)
      VALUES (?, ?, ?, ?, ?)
    `).run('Admin', 'System', 'ADMIN001', 'administrator', hash);
    console.log('✅ Seed: Admin creat (badge: ADMIN001, parolă: admin123)');
  }

  // Update shifts with times
  const shiftsCount = db.prepare('SELECT count(*) as count FROM shifts').get().count;
  if (shiftsCount === 0) {
    db.prepare('INSERT INTO shifts (name, start_time, end_time) VALUES (?, ?, ?)').run('Schimb 1', '06:00', '14:00');
    db.prepare('INSERT INTO shifts (name, start_time, end_time) VALUES (?, ?, ?)').run('Schimb 2', '14:00', '22:00');
    db.prepare('INSERT INTO shifts (name, start_time, end_time) VALUES (?, ?, ?)').run('Schimb 3', '22:00', '06:00');
    console.log('✅ Seed: Schimburi 1, 2, 3 create');
  }

  // Delay reasons
  const checkDelayReason = db.prepare('SELECT id FROM delay_reasons LIMIT 1').get();
  if (!checkDelayReason) {
    const reasons = [
      ['Defecțiune Mecanică', 'mechanical'],
      ['Defecțiune Electrică', 'electrical'],
      ['Lipsă Materie Primă', 'material'],
      ['Lipsă Operator', 'human'],
      ['Schimbare Format (Setup)', 'setup'],
      ['Mentenanță Planificată', 'maintenance'],
      ['Pauză Masă', 'human'],
      ['Altele', 'general']
    ];
    const stmt = db.prepare('INSERT INTO delay_reasons (name, category) VALUES (?, ?)');
    reasons.forEach(r => stmt.run(r[0], r[1]));
    console.log('✅ Seed: Motive întârzieri create');
  }

  // Demo area + machine
  const area = db.prepare('SELECT id FROM areas WHERE name = ?').get('Aria Demo');
  if (!area) {
    const areaRes = db.prepare('INSERT INTO areas (name, description) VALUES (?, ?)').run('Aria Demo', 'Arie de producție demonstrativă');
    db.prepare('INSERT INTO machines (area_id, name, setup_time_min, working_time_min, supervision_time_min) VALUES (?,?,?,?,?)').run(areaRes.lastInsertRowid, 'Utilaj 1', 30, 480, 20);
    db.prepare('INSERT INTO machines (area_id, name, setup_time_min, working_time_min, supervision_time_min) VALUES (?,?,?,?,?)').run(areaRes.lastInsertRowid, 'Utilaj 2', 45, 360, 30);
    console.log('✅ Seed: Arie Demo + 2 utilaje create');
  }

  // Demo users
  const planner = db.prepare('SELECT id FROM users WHERE badge_number = ?').get('PLN001');
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
      db.prepare('INSERT OR IGNORE INTO users (first_name, last_name, badge_number, role, password_hash) VALUES (?,?,?,?,?)').run(fn, ln, badge, role, hash);
    }
    console.log('✅ Seed: Useri demo creați');
  }

  // Defect reasons
  const checkReason = db.prepare('SELECT id FROM defect_reasons LIMIT 1').get();
  if (!checkReason) {
    const reasons = ['Dimensiune incorectă', 'Zgârieturi suprafață', 'Eroare material', 'Defect asamblare', 'Altele'];
    const stmt = db.prepare('INSERT INTO defect_reasons (name) VALUES (?)');
    reasons.forEach(r => stmt.run(r));
    console.log('✅ Seed: Motive defecte create');
  }
}

// Export a unified object. We keep the old names for backward compatibility.
module.exports = { 
  db, 
  usersDb: db, 
  machinesDb: db, 
  ordersDb: db, 
  productionDb: db, 
  shiftReportsDb: db, 
  itemsDb: db, 
  seedIfNeeded 
};
