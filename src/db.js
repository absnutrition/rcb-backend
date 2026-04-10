// ─────────────────────────────────────────────────────
//  db.js — PostgreSQL connection
//
//  Railway automatically provides these env vars when
//  you add a Postgres database to your project:
//    PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
//
//  We use those individual variables instead of
//  DATABASE_URL to avoid any quoting/parsing issues.
// ─────────────────────────────────────────────────────
const { Pool } = require('pg');

let pool;

function getPool() {
  if (pool) return pool;

  // Railway sets these automatically — no manual config needed
  pool = new Pool({
    host:     process.env.PGHOST,
    port:     parseInt(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user:     process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl:      { rejectUnauthorized: false },
    max:      10,
    idleTimeoutMillis:    30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', err => {
    console.error('[DB] Unexpected pool error:', err.message);
  });

  return pool;
}

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await getPool().query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('[DB]', { duration, rows: res.rowCount });
    }
    return res;
  } catch (err) {
    console.error('[DB] Query error:', err.message);
    throw err;
  }
}

async function initSchema() {
  console.log('[DB] Creating tables if needed...');

  await query(`
    CREATE TABLE IF NOT EXISTS admin_account (
      id                  TEXT PRIMARY KEY,
      email               TEXT NOT NULL UNIQUE,
      password_hash       TEXT NOT NULL,
      totp_secret         TEXT,
      totp_secret_pending TEXT,
      failed_attempts     INTEGER DEFAULT 0,
      last_login_at       TIMESTAMPTZ,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS customers (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      first_name    TEXT DEFAULT '',
      last_name     TEXT DEFAULT '',
      phone         TEXT DEFAULT '',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id                       TEXT PRIMARY KEY,
      order_number             TEXT NOT NULL UNIQUE,
      tenant_id                TEXT DEFAULT 'rcb',
      tenant_name              TEXT DEFAULT 'Rocket City Banner',
      stripe_session_id        TEXT,
      stripe_payment_intent_id TEXT,
      status                   TEXT DEFAULT 'pending_payment',
      customer                 JSONB DEFAULT '{}',
      items                    JSONB DEFAULT '[]',
      subtotal                 NUMERIC(10,2) DEFAULT 0,
      tax                      NUMERIC(10,2) DEFAULT 0,
      total                    NUMERIC(10,2) DEFAULT 0,
      discount_code            TEXT,
      discount_savings         NUMERIC(10,2) DEFAULT 0,
      tracking_number          TEXT,
      carrier                  TEXT,
      shipping_address         JSONB,
      drive_folder_link        TEXT,
      drive_files              JSONB DEFAULT '[]',
      proof                    JSONB,
      notes                    TEXT DEFAULT '',
      created_at               TIMESTAMPTZ DEFAULT NOW(),
      updated_at               TIMESTAMPTZ DEFAULT NOW(),
      paid_at                  TIMESTAMPTZ,
      order_placed_at          TIMESTAMPTZ,
      approval_sent_at         TIMESTAMPTZ,
      order_approved_at        TIMESTAMPTZ,
      printed_at               TIMESTAMPTZ,
      shipped_at               TIMESTAMPTZ,
      received_at              TIMESTAMPTZ,
      cancelled_at             TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS discounts (
      id              TEXT PRIMARY KEY,
      code            TEXT NOT NULL UNIQUE,
      description     TEXT DEFAULT '',
      discount_type   TEXT NOT NULL CHECK (discount_type IN ('percent','flat')),
      discount_value  NUMERIC(10,2) NOT NULL,
      start_date      TIMESTAMPTZ,
      end_date        TIMESTAMPTZ,
      max_uses        INTEGER,
      used_count      INTEGER DEFAULT 0,
      min_order_value NUMERIC(10,2) DEFAULT 0,
      tenant_id       TEXT DEFAULT 'all',
      active          BOOLEAN DEFAULT true,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Seed default settings
  const defaults = {
    businessName:        'Rocket City Banner',
    businessEmail:       'orders@rocketcitybanner.com',
    businessPhone:       '',
    businessAddress:     'Huntsville, Alabama',
    orderPrefix:         'RCB',
    taxRate:             '9',
    emailNotifications:  'true',
    googleDriveEnabled:  'false',
    googleDriveFolderId: '',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }

  // Indexes
  await query(`CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_orders_tenant     ON orders(tenant_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_orders_created    ON orders(created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_customers_email   ON customers(email)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_discounts_code    ON discounts(code)`);

  console.log('[DB] Schema ready ✓');
}

async function testConnection() {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch (err) {
    console.error('[DB] Connection test failed:', err.message);
    return false;
  }
}

module.exports = { query, initSchema, testConnection };
