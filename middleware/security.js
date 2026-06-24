const rateLimitStore = new Map();

export function rateLimit({ windowMs = 60000, max = 100, message = 'Too many requests' } = {}) {
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record || now - record.resetTime > windowMs) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    record.count++;
    if (record.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
