const nodemailer = require('nodemailer');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const FROM = process.env.EMAIL_FROM || 'Rocket City Banner <orders@rocketcitybanner.com>';

function header(name) {
  return `<div style="background:#0a1628;padding:24px 32px;border-bottom:4px solid #c8102e;"><div style="font-family:Georgia,serif;font-size:24px;color:#fff;letter-spacing:2px;">${name||'ROCKET CITY BANNER'}</div></div>`;
}
function footer(name) {
  return `<div style="background:#0a1628;padding:16px 32px;text-align:center;"><div style="color:rgba(245,240,232,0.4);font-size:12px;">© ${new Date().getFullYear()} ${name||'Rocket City Banner'}</div></div>`;
}

async function sendOrderConfirmation(order) {
  if (!process.env.SMTP_USER) return;
  const c = order.customer || {};
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
    ${header(order.tenant_name)}
    <div style="padding:28px 32px;">
      <h2 style="color:#0a1628;margin-bottom:8px;">Order Confirmed!</h2>
      <p style="color:#555;margin-bottom:20px;">Hi ${c.firstName||'there'}, thank you for your order. We have received your files and will be in touch with a proof shortly.</p>
      <div style="background:#f5f0e8;border-radius:8px;padding:14px 18px;margin-bottom:20px;"><div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Order Number</div><div style="font-size:22px;font-weight:700;color:#c8102e;">${order.order_number}</div></div>
      <p style="color:#555;font-size:14px;">You can track your order at: <a href="${process.env.FRONTEND_URL}/track?order=${order.order_number}" style="color:#c8102e;">${process.env.FRONTEND_URL}/track?order=${order.order_number}</a></p>
    </div>
    ${footer(order.tenant_name)}
  </div>`;
  await getTransporter().sendMail({ from: FROM, to: c.email, subject: `Order Confirmed — ${order.order_number}`, html });
}

async function sendAdminAlert(order) {
  if (!process.env.SMTP_USER || !process.env.ADMIN_EMAIL) return;
  const c = order.customer || {};
  const html = `<div style="font-family:Arial;max-width:500px;"><div style="background:#c8102e;padding:16px 24px;color:white;font-size:18px;font-weight:bold;">🛒 New Order: ${order.order_number}</div><div style="padding:20px 24px;border:1px solid #eee;"><p><strong>Customer:</strong> ${c.firstName} ${c.lastName} &lt;${c.email}&gt;</p><p><strong>Total:</strong> $${parseFloat(order.total).toFixed(2)}</p><a href="${process.env.FRONTEND_URL?.replace('rcb-frontend-indol.vercel.app','rcb-backend-production-7fb4.up.railway.app')}/admin" style="display:inline-block;background:#0a1628;color:white;padding:10px 24px;border-radius:6px;text-decoration:none;margin-top:12px;">View in Admin →</a></div></div>`;
  await getTransporter().sendMail({ from: FROM, to: process.env.ADMIN_EMAIL, subject: `[NEW ORDER] ${order.order_number}`, html });
}

async function sendStatusUpdate(order, status, trackingNumber) {
  if (!process.env.SMTP_USER) return;
  const messages = {
    printed:       { subject: 'Your banners are printed!', body: 'Your banners have finished printing and are being prepared for shipping.' },
    shipped:       { subject: 'Your order has shipped!', body: `Your banners are on their way!${trackingNumber ? ` Tracking: <strong>${trackingNumber}</strong>` : ''}` },
    order_approved:{ subject: 'Proof approved — in production!', body: 'Your proof has been approved and your order is now in production.' },
  };
  const msg = messages[status]; if (!msg) return;
  const c = order.customer || {};
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">${header(order.tenant_name)}<div style="padding:28px 32px;"><h2 style="color:#0a1628;margin-bottom:8px;">${msg.subject}</h2><p style="color:#555;margin-bottom:20px;">${msg.body}</p><a href="${process.env.FRONTEND_URL}/track?order=${order.order_number}" style="display:inline-block;background:#c8102e;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;">Track Your Order</a></div>${footer(order.tenant_name)}</div>`;
  await getTransporter().sendMail({ from: FROM, to: c.email, subject: `${msg.subject} — ${order.order_number}`, html });
}

async function sendProofEmail(order, proofUrl, notes) {
  if (!process.env.SMTP_USER) return;
  const c = order.customer || {};
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">${header(order.tenant_name)}<div style="padding:28px 32px;"><h2 style="color:#0a1628;margin-bottom:8px;">Your Proof is Ready</h2><p style="color:#555;margin-bottom:20px;">Hi ${c.firstName||'there'}, please review your artwork proof before we proceed to print.</p>${notes?`<div style="background:#fffbe6;border-left:4px solid #d4a843;padding:12px 16px;margin-bottom:20px;border-radius:0 6px 6px 0;"><strong>Notes from our team:</strong><br>${notes}</div>`:''}<div style="text-align:center;margin:28px 0;"><a href="${proofUrl}" style="display:inline-block;background:#c8102e;color:white;padding:16px 40px;border-radius:8px;font-size:18px;font-weight:700;text-decoration:none;">REVIEW & APPROVE PROOF →</a><p style="color:#888;font-size:12px;margin-top:10px;">Link expires in 7 days.</p></div></div>${footer(order.tenant_name)}</div>`;
  await getTransporter().sendMail({ from: FROM, to: c.email, subject: `Proof Ready for Review — ${order.order_number}`, html });
}

async function sendProofApprovedAlert(order, approvedBy) {
  if (!process.env.SMTP_USER || !process.env.ADMIN_EMAIL) return;
  const html = `<div style="font-family:Arial;max-width:500px;"><div style="background:#1a7a3a;padding:16px 24px;color:white;font-size:18px;font-weight:bold;">✅ Proof Approved — ${order.order_number}</div><div style="padding:20px 24px;border:1px solid #eee;"><p><strong>Approved by:</strong> ${approvedBy}</p><p style="color:#1a7a3a;font-weight:bold;margin-top:12px;">✅ Cleared for production.</p></div></div>`;
  await getTransporter().sendMail({ from: FROM, to: process.env.ADMIN_EMAIL, subject: `✅ Proof Approved — ${order.order_number}`, html });
}

async function sendProofRejectedAlert(order, notes) {
  if (!process.env.SMTP_USER || !process.env.ADMIN_EMAIL) return;
  const html = `<div style="font-family:Arial;max-width:500px;"><div style="background:#c8102e;padding:16px 24px;color:white;font-size:18px;font-weight:bold;">🔄 Changes Requested — ${order.order_number}</div><div style="padding:20px 24px;border:1px solid #eee;"><p><strong>Changes requested:</strong></p><div style="background:#fff8f8;border-left:4px solid #c8102e;padding:12px;margin-top:8px;">${notes}</div></div></div>`;
  await getTransporter().sendMail({ from: FROM, to: process.env.ADMIN_EMAIL, subject: `🔄 Changes Requested — ${order.order_number}`, html });
}

async function sendTwoFASetup(email, qrCodeDataUrl) {
  if (!process.env.SMTP_USER) return;
  const html = `<div style="font-family:Arial;max-width:480px;"><div style="background:#0a1628;padding:20px 24px;color:white;font-size:18px;font-weight:bold;">🔐 Admin 2FA Setup</div><div style="padding:24px;border:1px solid #eee;"><p>Scan this QR code with Google Authenticator or Authy:</p><div style="text-align:center;margin:20px 0;"><img src="${qrCodeDataUrl}" style="width:200px;height:200px;"></div><p style="color:#c8102e;font-size:13px;font-weight:bold;">Keep this QR code secure.</p></div></div>`;
  await getTransporter().sendMail({ from: FROM, to: email, subject: '🔐 Admin 2FA Setup — Rocket City Banner', html });
}

module.exports = { sendOrderConfirmation, sendAdminAlert, sendStatusUpdate, sendProofEmail, sendProofApprovedAlert, sendProofRejectedAlert, sendTwoFASetup };
