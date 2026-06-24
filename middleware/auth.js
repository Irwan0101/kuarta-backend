import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';

export const authenticate = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token tidak ditemukan' });
    }
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await query(
      `SELECT id, name, email, role, plan, plan_expires_at, avatar_url,
              reward_points, streak_count, token_version
       FROM users WHERE id=$1 AND is_active=true`,
      [decoded.userId]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'User tidak ditemukan' });
    }

    const user = result.rows[0];
    if (decoded.token_version !== undefined && user.token_version !== undefined) {
      if (decoded.token_version !== user.token_version) {
        return res.status(401).json({ error: 'Sesi telah berakhir. Silakan login ulang.', code: 'TOKEN_REVOKED' });
      }
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token kedaluwarsa', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token tidak valid' });
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak — hanya admin' });
  }
  next();
};

export const requireMentor = (req, res, next) => {
  if (!['admin', 'mentor'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Akses ditolak — hanya mentor atau admin' });
  }
  next();
};

export const optionalAuth = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const token = auth.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await query('SELECT id, name, email, role, plan FROM users WHERE id=$1', [decoded.userId]);
      if (result.rows.length) req.user = result.rows[0];
    }
  } catch (_) {
    // Silent fail for optional auth — token invalid or expired is fine
  }
  next();
};
