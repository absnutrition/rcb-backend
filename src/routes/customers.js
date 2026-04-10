const express = require('express');
const { query } = require('../db');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const router = express.Router();

function toCustomer(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name, phone: row.phone, createdAt: row.created_at };
}

router.get('/', requireAdmin, async (req, res) => {
  const { search, page = 1, limit = 25 } = req.query;
  const offset = (parseInt(page)-1)*parseInt(limit);
  let conditions = ['1=1']; let params = []; let i = 1;
  if (search) { conditions.push(`(email ILIKE $${i} OR first_name ILIKE $${i} OR last_name ILIKE $${i})`); params.push(`%${search}%`); i++; }
  const total = parseInt((await query(`SELECT COUNT(*) FROM customers WHERE ${conditions.join(' AND ')}`, params)).rows[0].count);
  params.push(parseInt(limit), offset);
  const r = await query(`SELECT id, email, first_name, last_name, phone, created_at FROM customers WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`, params);
  res.json({ customers: r.rows.map(toCustomer), total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)) });
});

router.get('/me/orders', requireAuth, async (req, res) => {
  const cr = await query('SELECT id, email, first_name, last_name, phone FROM customers WHERE email = $1', [req.user.email]);
  const orders = await query(`SELECT id, order_number, status, total, items, created_at, tracking_number, proof FROM orders WHERE customer->>'email' = $1 ORDER BY created_at DESC`, [req.user.email]);
  res.json({
    customer: toCustomer(cr.rows[0]),
    orders: orders.rows.map(o => ({
      id: o.id, orderNumber: o.order_number, status: o.status, total: +o.total,
      items: o.items, createdAt: o.created_at, trackingNumber: o.tracking_number,
      proof: o.proof ? { status: o.proof.status, proofUrl: o.proof.status === 'pending' ? o.proof.proofUrl : null } : null,
    })),
  });
});

router.get('/:id', requireAdmin, async (req, res) => {
  const cr = await query('SELECT id, email, first_name, last_name, phone, created_at FROM customers WHERE id = $1', [req.params.id]);
  if (!cr.rows[0]) return res.status(404).json({ error: 'Not found' });
  const or = await query(`SELECT * FROM orders WHERE customer->>'email' = $1 ORDER BY created_at DESC`, [cr.rows[0].email]);
  res.json({ ...toCustomer(cr.rows[0]), orders: or.rows });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const r = await query('DELETE FROM customers WHERE id = $1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
