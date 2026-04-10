// ─────────────────────────────────────────────────────
//  Tenant configuration
//  Add new storefronts here. Set active: true when live.
// ─────────────────────────────────────────────────────

const DEFAULT_PRICING = {
  mesh: 5.00, standard: 4.00, premium: 4.50,
  extra_durable: 5.00, double_sided: 8.50,
};

const TENANTS = [
  {
    id:          'rcb',
    domains:     ['rocketcitybanner.com', 'www.rocketcitybanner.com', 'rcb-frontend-indol.vercel.app', 'localhost:3000', 'localhost:5500', '127.0.0.1:5500'],
    name:        'Rocket City Banner',
    tagline:     'Banners Built to Stand Out.',
    subTagline:  'Made in Huntsville, Alabama',
    email:       'orders@rocketcitybanner.com',
    orderPrefix: 'RCB',
    colors:      { primary: '#c8102e', secondary: '#0a1628', accent: '#d4a843', cream: '#f5f0e8' },
    heroTitle:   ['BANNERS', 'BUILT TO', 'STAND OUT.'],
    heroHighlightLine: 2,
    tagBadge:    'Fast Turnaround · Ships Nationwide',
    eyebrow:     'Made in Huntsville, Alabama',
    pricingOverrides: {},
    active:      true,
  },
  {
    id:          'rivcity',
    domains:     ['rivercitybanner.com', 'www.rivercitybanner.com'],
    name:        'River City Banner',
    tagline:     'Premium Banners for Every Occasion.',
    subTagline:  'Serving the River City Region',
    email:       'orders@rivercitybanner.com',
    orderPrefix: 'RIV',
    colors:      { primary: '#1a5fa8', secondary: '#0d2e1a', accent: '#c8a84b', cream: '#f0f4f8' },
    heroTitle:   ['PREMIUM', 'BANNERS', 'DELIVERED.'],
    heroHighlightLine: 1,
    tagBadge:    'Quality Printing · Fast Delivery',
    eyebrow:     'Serving the River City Region',
    pricingOverrides: { premium: 4.75, extra_durable: 5.25 },
    active:      false,
  },
];

function getTenant(origin = '') {
  const host = origin.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  return TENANTS.find(t => t.active && t.domains.some(d => d === host))
    || TENANTS.find(t => t.id === 'rcb');
}

function getAll()    { return TENANTS; }
function getActive() { return TENANTS.filter(t => t.active); }

function getPricing(tenant) {
  return { ...DEFAULT_PRICING, ...(tenant.pricingOverrides || {}) };
}

function getPublicConfig(tenant) {
  return {
    tenantId:          tenant.id,
    name:              tenant.name,
    tagline:           tenant.tagline,
    subTagline:        tenant.subTagline,
    email:             tenant.email,
    orderPrefix:       tenant.orderPrefix,
    colors:            tenant.colors,
    heroTitle:         tenant.heroTitle,
    heroHighlightLine: tenant.heroHighlightLine,
    tagBadge:          tenant.tagBadge,
    eyebrow:           tenant.eyebrow,
    pricing:           getPricing(tenant),
  };
}

// Middleware — attaches req.tenant to every request
function tenantMiddleware(req, res, next) {
  req.tenant = getTenant(req.headers.origin || req.headers.referer || '');
  res.setHeader('X-Tenant-ID', req.tenant.id);
  next();
}

module.exports = { getTenant, getAll, getActive, getPricing, getPublicConfig, tenantMiddleware };
