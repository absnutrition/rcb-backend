const jwt = require('jsonwebtoken');

function getSecret() {
  return process.env.JWT_SECRET || 'dev-secret-change-in-production';
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], getSecret());
    next();
  } catch (err) {
    const code = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    res.status(401).json({ error: err.message, code });
  }
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.adminToken ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);

  if (!token) return res.status(401).json({ error: 'Admin authentication required', code: 'NO_TOKEN' });

  try {
    const decoded = jwt.verify(token, getSecret());
    if (decoded.role !== 'admin')          return res.status(403).json({ error: 'Admin access required' });
    if (!decoded.twoFactorVerified)        return res.status(403).json({ error: '2FA required', code: 'REQUIRE_2FA' });
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: err.message, code: 'INVALID_TOKEN' });
  }
}

function signToken(payload, expiresIn = '15m') {
  return jwt.sign(payload, getSecret(), { expiresIn });
}

module.exports = { requireAuth, requireAdmin, signToken };
