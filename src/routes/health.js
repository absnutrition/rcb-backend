const express = require('express');
const { testConnection } = require('../db');
const router = express.Router();

router.get('/', async (req, res) => {
  const db = await testConnection();
  res.json({
    status:    db ? 'ok' : 'degraded',
    database:  db ? 'connected' : 'unavailable',
    version:   '2.0.0',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV,
  });
});

module.exports = router;
