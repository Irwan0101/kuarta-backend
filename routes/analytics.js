import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

/* ─── Track visit (public) ─── */
router.post('/track', async (req, res) => {
  try {
    const { page, referrer, userAgent, deviceType, sessionId } = req.body;
    if (!page) return res.status(400).json({ error: 'page required' });
    await query(`
      INSERT INTO tracked_visits (page, referrer, user_agent, ip_address, device_type, user_id, session_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [page, referrer || null, userAgent || null, req.ip || req.headers['x-forwarded-for'], deviceType || 'desktop', req.user?.id || null, sessionId || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal track' });
  }
});

/* ─── Analytics overview (admin only) ─── */
router.get('/overview', authenticate, requireAdmin, async (req, res) => {
  try {
    const period = req.query.period || '7d';
    const interval = period === '24h' ? '24 hours' : period === '7d' ? '7 days' : '30 days';

    const [totalVisits, uniqueVisitors, dailyStats, topPages, referrers, devices, hourly] =
      await Promise.all([
        query(`SELECT COUNT(*)::int AS total FROM tracked_visits WHERE created_at > NOW() - INTERVAL '${interval}'`),
        query(`SELECT COUNT(DISTINCT COALESCE(ip_address, session_id))::int AS total FROM tracked_visits WHERE created_at > NOW() - INTERVAL '${interval}'`),
        query(`
          SELECT DATE(created_at) AS date, COUNT(*)::int AS visits,
            COUNT(DISTINCT COALESCE(ip_address, session_id))::int AS visitors
          FROM tracked_visits
          WHERE created_at > NOW() - INTERVAL '${interval}'
          GROUP BY DATE(created_at) ORDER BY date
        `),
        query(`
          SELECT page, COUNT(*)::int AS visits, COUNT(DISTINCT COALESCE(ip_address, session_id))::int AS visitors
          FROM tracked_visits
          WHERE created_at > NOW() - INTERVAL '${interval}'
          GROUP BY page ORDER BY visits DESC LIMIT 15
        `),
        query(`
          SELECT COALESCE(NULLIF(referrer, ''), '(direct)') AS source, COUNT(*)::int AS visits
          FROM tracked_visits
          WHERE created_at > NOW() - INTERVAL '${interval}'
          GROUP BY source ORDER BY visits DESC LIMIT 10
        `),
        query(`
          SELECT device_type, COUNT(*)::int AS visits
          FROM tracked_visits
          WHERE created_at > NOW() - INTERVAL '${interval}'
          GROUP BY device_type ORDER BY visits DESC
        `),
        query(`
          SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS visits
          FROM tracked_visits
          WHERE created_at > NOW() - INTERVAL '${interval}'
          GROUP BY hour ORDER BY hour
        `),
      ]);

    const totalAll = (await query('SELECT COUNT(*)::int AS total FROM tracked_visits')).rows[0].total;

    res.json({
      total: totalVisits.rows[0]?.total || 0,
      unique: uniqueVisitors.rows[0]?.total || 0,
      totalAllTime: totalAll,
      daily: dailyStats.rows || [],
      pages: topPages.rows || [],
      referrers: referrers.rows || [],
      devices: devices.rows || [],
      hourly: hourly.rows || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat analytics' });
  }
});

export default router;
