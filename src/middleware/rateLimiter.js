// rateLimiter.js
const rateLimit = require('express-rate-limit');

const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }, // disable proxy header validation (Railway uses proxies)
  message: { error: 'Too many requests. Please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many login attempts. Please wait 15 minutes.' },
});

const twoFALimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  validate: { xForwardedForHeader: false },
  message: { error: 'Too many 2FA attempts. Please wait 5 minutes.' },
});

module.exports = { rateLimiter, authLimiter, twoFALimiter };
