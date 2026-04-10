const express = require('express');
const crypto  = require('crypto');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.post('/send/:orderId', requireAdmin, async (req, res) => {
  try {
    const r = await query('SELECT * FROM orders WHERE id = $1', [req.params.orderId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Order not found' });
    const order = r.rows[0];
    const token    = crypto.randomBytes(32).toString('hex');
    const proofUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/proof/${token}`;
    const expiresAt = new Date(Date.now() + 7*24*60*60*1000).toISOString();
    const proof = { token, proofUrl, proofNotes: req.body.proofNotes||'', sentAt: new Date().toISOString(), expiresAt, status: 'pending', history: [] };
    await query(`UPDATE orders SET proof=$1, status='approval_sent', approval_sent_at=NOW(), updated_at=NOW() WHERE id=$2`, [JSON.stringify(proof), order.id]);
    try {
      const { sendProofEmail } = require('../services/email');
      await sendProofEmail({ ...order, proof }, proofUrl, req.body.proofNotes);
    } catch(e) { console.error('[Proof] Email failed:', e.message); }
    res.json({ success: true, proofUrl, expiresAt });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.get('/:token', async (req, res) => {
  const r = await query(`SELECT * FROM orders WHERE proof->>'token' = $1`, [req.params.token]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Proof not found' });
  const order = r.rows[0];
  const proof = order.proof;
  if (new Date(proof.expiresAt) < new Date()) return res.status(410).json({ error: 'This proof link has expired.' });
  res.json({ orderNumber: order.order_number, tenantName: order.tenant_name, proofStatus: proof.status, proofNotes: proof.proofNotes, previewImageUrl: proof.previewImageUrl||null, sentAt: proof.sentAt, expiresAt: proof.expiresAt, approvedAt: proof.approvedAt, approvedBy: proof.approvedBy, items: order.items });
});

router.post('/:token/approve', async (req, res) => {
  try {
    const { approvedBy } = req.body;
    if (!approvedBy?.trim()) return res.status(400).json({ error: 'Please enter your full name to approve' });
    const r = await query(`SELECT * FROM orders WHERE proof->>'token' = $1`, [req.params.token]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Proof not found' });
    const order = r.rows[0];
    const proof = { ...order.proof, status: 'approved', approvedAt: new Date().toISOString(), approvedBy: approvedBy.trim() };
    await query(`UPDATE orders SET proof=$1, status='order_approved', order_approved_at=NOW(), updated_at=NOW() WHERE id=$2`, [JSON.stringify(proof), order.id]);
    try { const { sendProofApprovedAlert } = require('../services/email'); await sendProofApprovedAlert(order, approvedBy.trim()); } catch(e) {}
    res.json({ success: true, message: 'Proof approved! Your order is now in production.' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

router.post('/:token/reject', async (req, res) => {
  try {
    const { rejectionNotes } = req.body;
    if (!rejectionNotes?.trim()) return res.status(400).json({ error: 'Please describe the changes needed' });
    const r = await query(`SELECT * FROM orders WHERE proof->>'token' = $1`, [req.params.token]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Proof not found' });
    const order = r.rows[0];
    const proof = { ...order.proof, status: 'changes_requested', rejectedAt: new Date().toISOString(), rejectionNotes: rejectionNotes.trim() };
    await query(`UPDATE orders SET proof=$1, status='order_placed', updated_at=NOW() WHERE id=$2`, [JSON.stringify(proof), order.id]);
    try { const { sendProofRejectedAlert } = require('../services/email'); await sendProofRejectedAlert(order, rejectionNotes.trim()); } catch(e) {}
    res.json({ success: true, message: 'Changes requested. We will revise and send a new proof shortly.' });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
