const express = require('express');
const tenants = require('../config/tenants');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.get('/config', (req, res) => {
  const tenant = tenants.getTenant(req.headers.origin || req.headers.referer || '');
  res.json(tenants.getPublicConfig(tenant));
});

router.get('/all', requireAdmin, (req, res) => {
  res.json(tenants.getAll().map(t => ({
    id: t.id, name: t.name, domains: t.domains,
    orderPrefix: t.orderPrefix, active: t.active,
    colors: t.colors, pricing: tenants.getPricing(t),
  })));
});

module.exports = router;
