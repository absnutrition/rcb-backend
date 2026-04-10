const express = require('express');
const { query } = require('../db');
const { requireAdmin, requireAuth } = require('../middleware/auth');
const router = express.Router();

const STATUSES = ['pending_payment','order_placed','approval_sent','order_approved','printed','shipped','received','cancelled','refunded'];

const STATUS_LABELS = {
  pending_payment: 'Pending Payment', order_placed: 'Order Placed',
  approval_sent: 'Approval Sent', order_approved: 'Order Approved',
  printed: 'Printed', shipped: 'Shipped', received: 'Received',
  cancelled: 'Cancelled', refunded: 'Refunded',
};

const PROGRESS_STEPS = [
  { key: 'order_placed',   label: 'Order Placed' },
  { key: 'approval_sent',  label: 'Proof Review' },
  { key: 'order_approved', label: 'Approved' },
  { key: 'printed',        label: 'Printed' },
  { key: 'shipped',        label: 'Shipped' },
  { key: 'received',       label: 'Received' },
];

function toOrder(row) {
  if (!row) return null;
  return {
    id: row.id, orderNumber: row.order_number, tenantId: row.tenant_id, tenantName: row.tenant_name,
    stripeSessionId: row.stripe_session_id, stripePaymentIntentId: row.stripe_payment_intent_id,
    status: row.status, customer: row.customer, items: row.items,
    subtotal: +row.subtotal, tax: +row.tax, total: +row.total,
    discountCode: row.discount_code, discountSavings: +row.discount_savings,
    trackingNumber: row.tracking_number, carrier: row.carrier,
    shippingAddress: row.shipping_address, driveFolderLink: row.drive_folder_link,
    driveFiles: row.drive_files, proof: row.proof, notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at,
    paidAt: row.paid_at, orderPlacedAt: row.order_placed_at,
    approvalSentAt: row.approval_sent_at, orderApprovedAt: row.order_approved_at,
    printedAt: row.printed_at, shippedAt: row.shipped_at,
    receivedAt: row.received_at, cancelledAt: row.cancelled_at,
  };
}

// GET /api/orders — admin list
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { status, search, from, to, tenant, page = 1, limit = 25 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = ['1=1']; const params = [];
    let i = 1;

    if (status && status !== 'all')   { conditions.push(`o.status = $${i++}`);      params.push(status); }
    if (tenant && tenant !== 'all')   { conditions.push(`o.tenant_id = $${i++}`);   params.push(tenant); }
    if (from)                         { conditions.push(`o.created_at >= $${i++}`); params.push(from); }
    if (to)                           { conditions.push(`o.created_at <= $${i++}`); params.push(to + 'T23:59:59Z'); }
    if (search) {
      conditions.push(`(o.order_number ILIKE $${i} OR o.customer->>'email' ILIKE $${i} OR o.customer->>'firstName' ILIKE $${i} OR o.customer->>'lastName' ILIKE $${i})`);
      params.push(`%${search}%`); i++;
    }

    const where = conditions.join(' AND ');
    const countR = await query(`SELECT COUNT(*) FROM orders o WHERE ${where}`, params);
    const total  = parseInt(countR.rows[0].count);

    params.push(parseInt(limit), offset);
    const ordersR = await query(
      `SELECT * FROM orders o WHERE ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`,
      params
    );

    res.json({ orders: ordersR.rows.map(toOrder), total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)) });
  } catch (err) {
    console.error('[Orders]', err.message);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/orders/stats
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const all   = await query('SELECT status, total FROM orders');
    const orders = all.rows;
    const paid  = orders.filter(o => !['pending_payment','payment_failed','cancelled'].includes(o.status));
    res.json({
      totalOrders:    orders.length,
      totalRevenue:   paid.reduce((s,o) => s + parseFloat(o.total), 0),
      pendingPayment: orders.filter(o => o.status === 'pending_payment').length,
      inProduction:   orders.filter(o => o.status === 'order_approved').length,
      shipped:        orders.filter(o => o.status === 'shipped').length,
    });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// GET /api/orders/track/:orderNumber — public tracking
router.get('/track/:orderNumber', async (req, res) => {
  try {
    const r = await query('SELECT * FROM orders WHERE order_number = $1', [req.params.orderNumber]);
    const order = toOrder(r.rows[0]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const stepKeys   = PROGRESS_STEPS.map(s => s.key);
    const currentIdx = stepKeys.indexOf(order.status);
    const tsMap = { order_placed: 'orderPlacedAt', approval_sent: 'approvalSentAt', order_approved: 'orderApprovedAt', printed: 'printedAt', shipped: 'shippedAt', received: 'receivedAt' };

    res.json({
      orderNumber:   order.orderNumber,
      status:        order.status,
      statusLabel:   STATUS_LABELS[order.status] || order.status,
      tenantName:    order.tenantName,
      createdAt:     order.createdAt,
      trackingNumber: order.trackingNumber,
      carrier:        order.carrier,
      shippedAt:      order.shippedAt,
      progressSteps:  PROGRESS_STEPS.map((step, idx) => ({
        key:       step.key,
        label:     step.label,
        completed: idx <= currentIdx && currentIdx >= 0,
        current:   step.key === order.status,
        timestamp: order[tsMap[step.key]] || null,
      })),
      items:  (order.items || []).map(i => ({ name: i.name, materialName: i.materialName, width: i.width, height: i.height, qty: i.qty, date: i.date })),
      proof:  order.proof ? { status: order.proof.status, proofUrl: order.proof.status === 'pending' ? order.proof.proofUrl : null, approvedAt: order.proof.approvedAt, approvedBy: order.proof.approvedBy } : null,
    });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// GET /api/orders/:id — admin single order
router.get('/:id', requireAdmin, async (req, res) => {
  const r = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Order not found' });
  res.json(toOrder(r.rows[0]));
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status, trackingNumber, carrier } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const tsCol = { order_placed: 'order_placed_at', approval_sent: 'approval_sent_at', order_approved: 'order_approved_at', printed: 'printed_at', shipped: 'shipped_at', received: 'received_at', cancelled: 'cancelled_at' };

    let sql = 'UPDATE orders SET status = $1, updated_at = NOW()';
    const params = [status];
    let i = 2;

    if (tsCol[status]) { sql += `, ${tsCol[status]} = NOW()`; }
    if (status === 'shipped' && trackingNumber) { sql += `, tracking_number = $${i++}, carrier = $${i++}`; params.push(trackingNumber, carrier || ''); }

    sql += ` WHERE id = $${i} RETURNING *`;
    params.push(req.params.id);

    const r = await query(sql, params);
    if (!r.rows[0]) return res.status(404).json({ error: 'Order not found' });

    const updated = toOrder(r.rows[0]);

    // Send email notification on key status changes
    if (['printed','shipped','order_approved'].includes(status)) {
      try {
        const { sendStatusUpdate } = require('../services/email');
        await sendStatusUpdate(updated, status, trackingNumber);
      } catch(e) { console.error('[Orders] Status email failed:', e.message); }
    }

    res.json(updated);
  } catch (err) {
    console.error('[Orders] Status update error:', err.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// PATCH /api/orders/:id/notes
router.patch('/:id/notes', requireAdmin, async (req, res) => {
  const r = await query('UPDATE orders SET notes = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [req.body.notes, req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(toOrder(r.rows[0]));
});

module.exports = router;
module.exports.toOrder   = toOrder;
module.exports.STATUSES  = STATUSES;
module.exports.STATUS_LABELS = STATUS_LABELS;
module.exports.PROGRESS_STEPS = PROGRESS_STEPS;
