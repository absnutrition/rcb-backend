// ─────────────────────────────────────────────────────
//  server.js — Application entry point v2
// ─────────────────────────────────────────────────────
require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const cookieParser = require('cookie-parser');
const path         = require('path');
const fs           = require('fs');

const { initSchema }        = require('./db');
const { rateLimiter }       = require('./middleware/rateLimiter');
const { errorHandler }      = require('./middleware/errorHandler');
const tenants               = require('./config/tenants');

const app  = express();
const PORT = process.env.PORT || 3001;

// Trust Railway's proxy (required for rate limiter and correct IP detection)
app.set('trust proxy', 1);
// ── Directories ───────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const LOG_DIR    = path.join(__dirname, '..', 'logs');
[UPLOAD_DIR, LOG_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── CORS ──────────────────────────────────────────────
const allowedOrigins = () => {
  const set = new Set([
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
  ]);
  tenants.getAll().forEach(t =>
    t.domains.forEach(d => {
      if (!d.includes('localhost')) {
        set.add(`https://${d}`);
        set.add(`http://${d}`);
      }
    })
  );
  (process.env.FRONTEND_URL || '').split(',').forEach(u => set.add(u.trim()));
  return [...set];
};

const corsOptions = {
  origin: (origin, cb) => {
    if (process.env.CORS_ALLOW_ALL === 'true') return cb(null, true);
    if (!origin) return cb(null, true);
    if (origin.endsWith('.vercel.app')) return cb(null, true);
    if (origin.endsWith('.railway.app')) return cb(null, true);
    if (allowedOrigins().includes(origin)) return cb(null, true);
    console.warn('[CORS] Blocked:', origin);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Tenant-ID'],
};

// ── Middleware ────────────────────────────────────────
// CORS must come first — before helmet and everything else
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = !origin
    || origin.endsWith('.vercel.app')
    || origin.endsWith('.railway.app')
    || process.env.CORS_ALLOW_ALL === 'true'
    || allowedOrigins().includes(origin);

  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Tenant-ID');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

// Stripe webhook needs raw body — must come before json parser
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'rcb-cookie-secret'));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

app.use('/api/', rateLimiter);

// ── Routes ────────────────────────────────────────────
app.use('/api/health',    require('./routes/health'));
app.use('/api/setup',     require('./routes/setup'));
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/tenant',    require('./routes/tenant'));
app.use('/api/orders',    require('./routes/orders'));
app.use('/api/stripe',    require('./routes/stripe'));
app.use('/api/uploads',   require('./routes/uploads'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/discounts', require('./routes/discounts'));
app.use('/api/proof',     require('./routes/proof'));
app.use('/api/reports',   require('./routes/reports'));
app.use('/api/settings',  require('./routes/settings'));
app.use('/api/admin',     require('./routes/admin'));

// ── Admin portal (static) ─────────────────────────────
app.use('/admin', express.static(path.join(__dirname, '../admin-portal')));
app.get('/admin/*', (req, res) =>
  res.sendFile(path.join(__dirname, '../admin-portal/index.html'))
);

// ── 404 / Error ───────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────
async function start() {
  // Verify DB vars are present
  const required = ['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`[DB] Missing environment variables: ${missing.join(', ')}`);
    console.error('[DB] Go to Railway → Postgres service → Variables tab and copy PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD into your rcb-backend Variables.');
    process.exit(1);
  }

  console.log('[DB] Connecting...');
  console.log('[DB] Host:', process.env.PGHOST);
  console.log('[DB] Database:', process.env.PGDATABASE);
  console.log('[DB] User:', process.env.PGUSER);

  await initSchema();

  app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`   Admin: http://localhost:${PORT}/admin`);
    console.log(`   Setup: http://localhost:${PORT}/api/setup\n`);
  });
}

start().catch(err => {
  console.error('[START] Fatal error:', err.message);
  process.exit(1);
});

module.exports = app;
