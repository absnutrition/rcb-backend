const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

function toDiscount(row) {
  return { id: row.id, code: row.code, description: row.description, discountType: row.discount_type, discountValue: +row.discount_value, startDate: row.start_date, endDate: row.end_date, maxUses: row.max_uses, usedCount: row.used_count, minOrderValue: +row.min_order_value, tenantId: row.tenant_id, active: row.active, createdAt: row.created_at };
}

function isActive(d) {
  if (!d.active) return false;
  const now = new Date();
  if (d.start_date && new Date(d.start_date) > now) return false;
  if (d.end_date   && new Date(d.end_date)   < now) return false;
  if (d.max_uses   && d.used_count >= d.max_uses)   return false;
  return true;
}

router.get('/', requireAdmin, async (req, res) => {
  const r = await query('SELECT * FROM discounts ORDER BY created_at DESC');
  res.json(r.rows.map(row => ({ ...toDiscount(row), status: isActive(row) ? 'active' : 'inactive' })));
});

router.post('/', requireAdmin, async (req, res) => {
  const { code, description, discountType, discountValue, startDate, endDate, maxUses, minOrderValue, tenantId } = req.body;
  if (!code || !discountType || discountValue === undefined) return res.status(400).json({ error: 'code, discountType, discountValue required' });
  const r = await query(`INSERT INTO discounts (id,code,description,discount_type,discount_value,start_date,end_date,max_uses,min_order_value,tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [uuidv4(), code.toUpperCase().trim(), description||'', discountType, discountValue, startDate||null, endDate||null, maxUses||null, minOrderValue||0, tenantId||'all']);
  res.status(201).json(toDiscount(r.rows[0]));
});

router.put('/:id', requireAdmin, async (req, res) => {
  const { description, discountType, discountValue, startDate, endDate, maxUses, minOrderValue, active, tenantId } = req.body;
  const r = await query(`UPDATE discounts SET description=$1,discount_type=$2,discount_value=$3,start_date=$4,end_date=$5,max_uses=$6,min_order_value=$7,active=$8,tenant_id=$9 WHERE id=$10 RETURNING *`,
    [description, discountType, discountValue, startDate||null, endDate||null, maxUses||null, minOrderValue||0, active, tenantId||'all', req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(toDiscount(r.rows[0]));
});

router.delete('/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM discounts WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

router.post('/validate', async (req, res) => {
  const { code, orderTotal, tenantId } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });
  const r = await query('SELECT * FROM discounts WHERE code = $1', [code.toUpperCase().trim()]);
  const d = r.rows[0];
  if (!d) return res.status(404).json({ valid: false, error: 'Invalid discount code' });
  if (!isActive(d)) return res.status(400).json({ valid: false, error: 'Code is not active or has expired' });
  if (d.tenant_id !== 'all' && tenantId && d.tenant_id !== tenantId) return res.status(400).json({ valid: false, error: 'Code not valid for this store' });
  const subtotal = parseFloat(orderTotal) || 0;
  if (d.min_order_value && subtotal < d.min_order_value) return res.status(400).json({ valid: false, error: `Minimum order of $${d.min_order_value} required` });
  const savings = d.discount_type === 'percent' ? subtotal*(d.discount_value/100) : Math.min(d.discount_value, subtotal);
  res.json({ valid: true, code: d.code, discountType: d.discount_type, discountValue: +d.discount_value, savings: Math.round(savings*100)/100, newTotal: Math.round((subtotal-savings)*100)/100, label: d.discount_type==='percent'?`${d.discount_value}% off`:`$${d.discount_value} off` });
});

module.exports = router;
