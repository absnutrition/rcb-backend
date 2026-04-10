const express  = require('express');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const router   = express.Router();

async function adminExists() {
  const r = await query('SELECT id FROM admin_account LIMIT 1');
  return r.rows.length > 0;
}

// GET /api/setup/debug — connection diagnostics
router.get('/debug', async (req, res) => {
  const vars = ['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD'];
  const env  = {};
  vars.forEach(k => { env[k] = process.env[k] ? '✓ set' : '✗ missing'; });

  let dbConnected = false;
  let adminCreated = false;
  try {
    await query('SELECT 1');
    dbConnected  = true;
    adminCreated = await adminExists();
  } catch(e) {}

  res.json({ env, dbConnected, adminCreated });
});

// GET /api/setup — setup form
router.get('/', async (req, res) => {
  if (await adminExists()) {
    return res.send(`<!DOCTYPE html><html><body style="font-family:Arial;text-align:center;padding:60px;background:#0a1628;color:#f5f0e8;">
      <h2 style="color:#c8102e;">Setup Already Complete</h2>
      <p style="margin:16px 0;">Admin account exists. This page is disabled.</p>
      <a href="/admin" style="color:#d4a843;">Go to Admin Portal →</a>
    </body></html>`);
  }

  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Setup — Rocket City Banner</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;background:#0a1628;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{background:#132040;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:40px;width:100%;max-width:420px}
  h1{font-size:20px;color:#f5f0e8;letter-spacing:2px;text-align:center;margin-bottom:4px}
  p{font-size:13px;color:rgba(245,240,232,0.45);text-align:center;margin-bottom:24px}
  label{display:block;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(245,240,232,0.4);margin-bottom:5px}
  input{width:100%;padding:11px 14px;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1);border-radius:6px;color:#f5f0e8;font-size:15px;margin-bottom:16px;font-family:Arial}
  input:focus{outline:none;border-color:rgba(200,16,46,0.6)}
  button{width:100%;background:#c8102e;color:white;border:none;padding:14px;border-radius:6px;font-size:16px;font-weight:700;cursor:pointer}
  button:disabled{opacity:0.5;cursor:not-allowed}
  .err{background:rgba(200,16,46,0.1);border:1px solid rgba(200,16,46,0.3);border-radius:6px;padding:12px;margin-bottom:16px;font-size:13px;color:#ff8888;display:none}
  .notice{background:rgba(212,168,67,0.1);border:1px solid rgba(212,168,67,0.3);border-radius:6px;padding:12px;margin-bottom:20px;font-size:13px;color:rgba(212,168,67,0.9)}
</style></head><body>
<div class="card">
  <h1>ROCKET CITY BANNER</h1>
  <p>First Time Admin Setup</p>
  <div class="notice">⚠️ This page works once only. It disables itself after your account is created.</div>
  <div class="err" id="err"></div>
  <label>Admin Email</label>
  <input type="email" id="email" value="Matt@Apparellab.ink">
  <label>Password (min 8 characters)</label>
  <input type="password" id="password" placeholder="Create a strong password">
  <label>Confirm Password</label>
  <input type="password" id="confirm" placeholder="Repeat password">
  <button id="btn">Create Admin Account</button>
</div>
<script>
document.getElementById('btn').addEventListener('click', createAdmin);
async function createAdmin() {
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirm  = document.getElementById('confirm').value;
  const err      = document.getElementById('err');
  const btn      = document.getElementById('btn');
  err.style.display = 'none';
  if (password.length < 8) { err.textContent = 'Password must be at least 8 characters.'; err.style.display = 'block'; return; }
  if (password !== confirm) { err.textContent = 'Passwords do not match.'; err.style.display = 'block'; return; }
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    const res  = await fetch(window.location.origin + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || 'Failed.'; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Create Admin Account'; return; }
    document.body.innerHTML = '<div style="font-family:Arial;text-align:center;padding:60px;background:#0a1628;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f5f0e8;"><div style="font-size:64px;margin-bottom:24px">✅</div><h2 style="color:#2aaa5c;font-size:28px;margin-bottom:12px">Admin Account Created!</h2><p style="color:rgba(245,240,232,0.6);margin-bottom:32px">Signed in as: ' + data.email + '</p><a href="/admin" style="background:#c8102e;color:white;padding:14px 40px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:700">Go to Admin Portal →</a></div>';
  } catch(e) { err.textContent = 'Network error: ' + e.message; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Create Admin Account'; }
}
</script></body></html>`);
});

// POST /api/setup — create admin account
router.post('/', async (req, res) => {
  try {
    if (await adminExists()) {
      return res.status(403).json({ error: 'Admin account already exists' });
    }
    const { email, password } = req.body;
    if (!email || !password)    return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8)    return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const hash = await bcrypt.hash(password, 12);
    await query(
      `INSERT INTO admin_account (id, email, password_hash) VALUES ($1, $2, $3)`,
      [uuidv4(), email.trim().toLowerCase(), hash]
    );
    console.log('[Setup] Admin account created:', email);
    res.json({ success: true, email: email.trim().toLowerCase() });
  } catch (err) {
    console.error('[Setup] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
