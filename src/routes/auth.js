const express   = require('express');
const bcrypt    = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { query }      = require('../db');
const { signToken, requireAdmin, requireAuth } = require('../middleware/auth');
const { authLimiter, twoFALimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// ── Admin: Step 1 — password ──────────────────────────
router.post('/admin/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const r = await query('SELECT * FROM admin_account LIMIT 1');
    const admin = r.rows[0];
    if (!admin) return res.status(401).json({ error: 'Admin account not configured. Visit /api/setup first.' });

    if (admin.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      await query('UPDATE admin_account SET failed_attempts = failed_attempts + 1 WHERE id = $1', [admin.id]);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await query('UPDATE admin_account SET failed_attempts = 0 WHERE id = $1', [admin.id]);

    // Issue short-lived partial token (not yet 2FA verified)
    const partialToken = signToken(
      { id: admin.id, email: admin.email, role: 'admin', twoFactorVerified: false },
      '10m'
    );

    if (!admin.totp_secret) {
      return res.json({ requires2FASetup: true, partialToken });
    }
    res.json({ requires2FA: true, partialToken });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Admin: Setup 2FA ──────────────────────────────────
router.post('/admin/setup-2fa', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(req.body.partialToken, process.env.JWT_SECRET || 'dev-secret-change-in-production');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });

    const r = await query('SELECT * FROM admin_account WHERE id = $1', [decoded.id]);
    const admin = r.rows[0];
    if (admin.totp_secret) return res.status(400).json({ error: '2FA already configured' });

    const secret = speakeasy.generateSecret({ name: `Rocket City Banner (${admin.email})`, issuer: 'RCB Admin' });
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    await query('UPDATE admin_account SET totp_secret_pending = $1 WHERE id = $2', [secret.base32, admin.id]);

    res.json({ qrCode, manualKey: secret.base32 });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
});

// ── Admin: Step 2 — verify 2FA ─────────────────────────
router.post('/admin/verify-2fa', twoFALimiter, async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(req.body.partialToken, process.env.JWT_SECRET || 'dev-secret-change-in-production');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });

    const r = await query('SELECT * FROM admin_account WHERE id = $1', [decoded.id]);
    const admin = r.rows[0];
    const secret = admin.totp_secret || admin.totp_secret_pending;
    if (!secret) return res.status(400).json({ error: '2FA not configured' });

    const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: req.body.code?.replace(/\s/g,''), window: 1 });
    if (!valid) return res.status(401).json({ error: 'Invalid code. Please try again.' });

    // If this was first-time setup, confirm the secret
    if (admin.totp_secret_pending && !admin.totp_secret) {
      await query('UPDATE admin_account SET totp_secret = $1, totp_secret_pending = NULL WHERE id = $2', [admin.totp_secret_pending, admin.id]);
    }

    await query('UPDATE admin_account SET last_login_at = NOW() WHERE id = $1', [admin.id]);

    const token = signToken({ id: admin.id, email: admin.email, role: 'admin', twoFactorVerified: true }, '8h');

    res.cookie('adminToken', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge:   8 * 60 * 60 * 1000,
    });

    res.json({ success: true, token, admin: { email: admin.email } });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
});

// ── Admin: Logout ─────────────────────────────────────
router.post('/admin/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.json({ success: true });
});

// ── Admin: Me ─────────────────────────────────────────
router.get('/admin/me', requireAdmin, async (req, res) => {
  const r = await query('SELECT email, last_login_at, totp_secret FROM admin_account WHERE id = $1', [req.admin.id]);
  const a = r.rows[0];
  res.json({ email: a.email, lastLoginAt: a.last_login_at, twoFAEnabled: !!a.totp_secret });
});

// ── Customer: Register ────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;
    if (!email || !password || !firstName || !lastName) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const existing = await query('SELECT id FROM customers WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with this email already exists' });

    const hash = await bcrypt.hash(password, 12);
    const r = await query(
      'INSERT INTO customers (id, email, password_hash, first_name, last_name, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, email, first_name, last_name',
      [uuidv4(), email.toLowerCase(), hash, firstName.trim(), lastName.trim(), phone || '']
    );
    const customer = r.rows[0];
    const token = signToken({ id: customer.id, email: customer.email, role: 'customer' });
    res.status(201).json({ token, customer: { id: customer.id, email: customer.email, firstName: customer.first_name, lastName: customer.last_name } });
  } catch (err) {
    console.error('[Auth] Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── Customer: Login ───────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const r = await query('SELECT * FROM customers WHERE email = $1', [email.toLowerCase()]);
    const customer = r.rows[0];
    if (!customer) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, customer.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = signToken({ id: customer.id, email: customer.email, role: 'customer' });
    res.json({ token, customer: { id: customer.id, email: customer.email, firstName: customer.first_name, lastName: customer.last_name } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
