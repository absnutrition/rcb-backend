const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.use(requireAdmin);

router.get('/', async (req, res) => {
  const r = await query('SELECT key, value FROM settings');
  const obj = {};
  r.rows.forEach(row => {
    if (row.value==='true') obj[row.key]=true;
    else if (row.value==='false') obj[row.key]=false;
    else if (!isNaN(row.value)&&row.value!=='') obj[row.key]=parseFloat(row.value);
    else obj[row.key]=row.value;
  });
  obj.stripeConfigured = !!(process.env.STRIPE_SECRET_KEY);
  res.json(obj);
});

router.put('/', async (req, res) => {
  const allowed = ['businessName','businessEmail','businessPhone','businessAddress','orderPrefix','taxRate','emailNotifications','googleDriveEnabled','googleDriveFolderId'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      await query(`INSERT INTO settings (key,value,updated_at) VALUES ($1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=$2,updated_at=NOW()`, [key, String(req.body[key])]);
    }
  }
  const r = await query('SELECT key,value FROM settings');
  const obj = {};
  r.rows.forEach(row => { obj[row.key] = row.value; });
  res.json(obj);
});

module.exports = router;
