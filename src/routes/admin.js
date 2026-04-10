const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(requireAdmin);

router.get('/dashboard', async (req, res) => {
  try {
    const ordersR = await query('SELECT status, total, created_at, order_number, customer, items FROM orders ORDER BY created_at DESC');
    const orders  = ordersR.rows;
    const paid    = orders.filter(o => !['pending_payment','cancelled'].includes(o.status));
    const revenue = paid.reduce((s,o) => s + parseFloat(o.total), 0);
    const custsR  = await query('SELECT COUNT(*) FROM customers');

    // Last 30 days trend
    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate()-i); const ds = d.toDateString();
      const dayOrders = paid.filter(o => new Date(o.created_at).toDateString() === ds);
      trend.push({ date: d.toLocaleDateString('en-US',{month:'short',day:'numeric'}), revenue: dayOrders.reduce((s,o)=>s+parseFloat(o.total),0), orders: dayOrders.length });
    }

    const statusBreakdown = {};
    orders.forEach(o => { statusBreakdown[o.status] = (statusBreakdown[o.status]||0)+1; });

    res.json({
  summary: {
  totalOrders:    orders.length,
  todayOrders:    orders.filter(o => new Date(o.created_at).toDateString() === new Date().toDateString()).length,
  totalRevenue:   revenue,
  totalCustomers: parseInt(custsR.rows[0].count),
  avgOrderValue:  paid.length ? revenue/paid.length : 0,
  pendingPayment: statusBreakdown['pending_payment']||0,
  inProduction:   (statusBreakdown['order_approved']||0)+(statusBreakdown['printed']||0),
  readyToShip:    statusBreakdown['printed']||0,
},
      recentOrders: orders.slice(0,8).map(o=>({ orderNumber: o.order_number, status: o.status, customerName: `${o.customer?.firstName||''} ${o.customer?.lastName||''}`.trim(), total: +o.total, createdAt: o.created_at, itemCount: (o.items||[]).length })),
      trend,
      statusBreakdown,
    });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/system-health', async (req, res) => {
  const { testConnection } = require('../db');
  const dbOk = await testConnection();
  res.json({
    timestamp: new Date().toISOString(),
    checks: {
      database: { connected: dbOk },
      stripe:   { connected: !!(process.env.STRIPE_SECRET_KEY) },
      email:    { connected: !!(process.env.SMTP_USER && process.env.SMTP_PASS) },
      drive:    { connected: !!(process.env.GOOGLE_DRIVE_FOLDER_ID) },
    },
  });
});

module.exports = router;
