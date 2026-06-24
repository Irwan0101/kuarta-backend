import { query } from '../db/pool.js';

export async function logAudit({ adminId, adminName, action, entityType, entityId, details, ipAddress }) {
  try {
    await query(
      `INSERT INTO audit_logs (admin_id, admin_name, action, entity_type, entity_id, details, ip_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [adminId, adminName, action, entityType, entityId || null, JSON.stringify(details || {}), ipAddress || null]
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

export function audit(action, entityType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (res.statusCode < 400) {
        const entityId = req.params.id || req.body?.id || body?.id || body?.result?.id || null;
        logAudit({
          adminId: req.user?.id,
          adminName: req.user?.name,
          action,
          entityType,
          entityId,
          details: { method: req.method, path: req.originalUrl, body: sanitizeBody(req.body) },
          ipAddress: req.ip || req.headers['x-forwarded-for'],
        });
      }
      return originalJson(body);
    };
    next();
  };
}

function sanitizeBody(body) {
  if (!body) return {};
  const safe = { ...body };
  delete safe.password;
  delete safe.password_hash;
  delete safe.token;
  delete safe.access_token;
  return safe;
}
