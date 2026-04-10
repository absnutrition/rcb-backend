const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const router = express.Router();

const TAX_RATE = 0.09; // 9% Madison, AL

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  return require('stripe')(key);
}

async function getNextOrderNumber(prefix = 'RCB') {
  const r = await query('SELECT COUNT(*) FROM orders');
  const seq = String(parseInt(r.rows[0].count) + 1).padStart(4, '0');
  const now = new Date();
  const yy  = String(now.getFullYear()).slice(2);
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  return `${prefix}-${yy}${mm}-${seq}`;
}

// POST /api/stripe/create-checkout-session
router.post('/create-checkout-session', async (req, res) => {
  try {
    const stripe   = getStripe();
    const { cart, customer, tenantId, discountCode } = req.body;

    if (!cart?.length) return res.status(400).json({ error: 'Cart is empty' });

    // Get order prefix from settings
    const settingsR = await query(`SELECT value FROM settings WHERE key = 'orderPrefix'`);
    const prefix    = settingsR.rows[0]?.value || 'RCB';
    const orderNumber = await getNextOrderNumber(prefix);

    // Build line items
    const lineItems = cart.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
          description: [item.materialName, item.doubleSided ? 'Double-sided' : null, `${item.width}"×${item.height}"`, `In-hands: ${item.date}`].filter(Boolean).join(' · '),
        },
        unit_amount: Math.round(item.unitPrice * 100),
      },
      quantity: item.qty,
    }));

    // Apply discount
    let discountSavings = 0;
    let appliedCode     = null;
    if (discountCode) {
      const dr = await query('SELECT * FROM discounts WHERE code = $1 AND active = true', [discountCode.toUpperCase()]);
      const d  = dr.rows[0];
      if (d) {
        const subtotal = cart.reduce((s, i) => s + i.total, 0);
        discountSavings = d.discount_type === 'percent'
          ? subtotal * (d.discount_value / 100)
          : Math.min(d.discount_value, subtotal);
        discountSavings = Math.round(discountSavings * 100) / 100;
        appliedCode = d.code;
        if (discountSavings > 0) {
          lineItems.push({ price_data: { currency: 'usd', product_data: { name: `Discount: ${d.code}` }, unit_amount: -Math.round(discountSavings * 100) }, quantity: 1 });
          await query('UPDATE discounts SET used_count = used_count + 1 WHERE id = $1', [d.id]);
        }
      }
    }

    // Tax (AL orders only — customer enters shipping at Stripe checkout)
    // We apply tax based on the address they provided in our form
    const shipState = (customer.address?.state || '').toUpperCase();
    const subtotal  = cart.reduce((s, i) => s + i.total, 0) - discountSavings;
    const taxAmount = shipState === 'AL' ? Math.round(subtotal * TAX_RATE * 100) / 100 : 0;
    if (taxAmount > 0) {
      lineItems.push({ price_data: { currency: 'usd', product_data: { name: 'Sales Tax — Madison, AL (9%)' }, unit_amount: Math.round(taxAmount * 100) }, quantity: 1 });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      mode:                'payment',
      payment_method_types: ['card'],
      line_items:          lineItems,
      customer_email:      customer.email,
      shipping_address_collection: { allowed_countries: ['US'] },
      metadata:            { orderNumber, tenantId: tenantId || 'rcb' },
      success_url:         `${frontendUrl}/?order_success=1&order=${orderNumber}`,
      cancel_url:          `${frontendUrl}/?order_cancelled=1`,
    });

    // Save order to database
    await query(`
      INSERT INTO orders (id, order_number, tenant_id, tenant_name, stripe_session_id, status, customer, items, subtotal, tax, total, discount_code, discount_savings, created_at)
      VALUES ($1,$2,$3,$4,$5,'pending_payment',$6,$7,$8,$9,$10,$11,$12,NOW())
    `, [
      uuidv4(), orderNumber, tenantId || 'rcb', req.body.tenantName || 'Rocket City Banner',
      session.id, JSON.stringify(customer), JSON.stringify(cart),
      subtotal, taxAmount, subtotal + taxAmount,
      appliedCode, discountSavings,
    ]);

    res.json({ sessionId: session.id, url: session.url, orderNumber });
  } catch (err) {
    console.error('[Stripe] Session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stripe/webhook
router.post('/webhook', async (req, res) => {
  try {
    const stripe = getStripe();
    const sig    = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).json({ error: `Webhook error: ${err.message}` });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await query(`
        UPDATE orders SET status = 'order_placed', paid_at = NOW(), order_placed_at = NOW(),
        stripe_payment_intent_id = $1, shipping_address = $2, updated_at = NOW()
        WHERE stripe_session_id = $3
      `, [session.payment_intent, JSON.stringify(session.shipping_details?.address || {}), session.id]);

      // Send confirmation emails
      const r = await query('SELECT * FROM orders WHERE stripe_session_id = $1', [session.id]);
      if (r.rows[0]) {
        try {
          const { sendOrderConfirmation, sendAdminAlert } = require('../services/email');
          await sendOrderConfirmation(r.rows[0]);
          await sendAdminAlert(r.rows[0]);
        } catch(e) { console.error('[Webhook] Email failed:', e.message); }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    res.status(500).json({ error: 'Webhook failed' });
  }
});

module.exports = router;
