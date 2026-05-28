import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [users, revenue, programs, tryouts] = await Promise.all([
      query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE plan='premium' OR plan='vip') as premium,
        COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '30 days') as new_this_month
       FROM users WHERE role='user'`),
      query(`SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE status='success'), 0) as total_revenue,
        COALESCE(SUM(gross_amount) FILTER (WHERE status='success' AND paid_at >= NOW()-INTERVAL '30 days'), 0) as monthly_revenue,
        COUNT(*) FILTER (WHERE status='success') as total_transactions,
        COUNT(*) FILTER (WHERE status='pending') as pending_transactions
       FROM transactions`),
      query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active) as active FROM programs`),
      query(`SELECT COUNT(*) as total FROM tryout_results`),
    ]);

    // Monthly revenue trend (last 6 months)
    const trend = await query(`
      SELECT DATE_TRUNC('month', paid_at) as month,
             SUM(gross_amount) as revenue,
             COUNT(*) as count
      FROM transactions
      WHERE status='success' AND paid_at >= NOW()-INTERVAL '6 months'
      GROUP BY 1 ORDER BY 1`
    );

    // Top programs by revenue
    const topPrograms = await query(`
      SELECT p.name, p.icon, COUNT(t.id) as sales, SUM(t.gross_amount) as revenue
      FROM transactions t JOIN programs p ON p.id=t.program_id
      WHERE t.status='success'
      GROUP BY p.id, p.name, p.icon
      ORDER BY revenue DESC LIMIT 5`
    );

    res.json({
      users: users.rows[0],
      revenue: revenue.rows[0],
      programs: programs.rows[0],
      tryouts: tryouts.rows[0],
      trend: trend.rows,
      top_programs: topPrograms.rows,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Gagal mengambil statistik' });
  }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const { search, plan, role, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = ["role != 'admin'"];

    if (search) { params.push(`%${search}%`); conditions.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`); }
    if (plan) { params.push(plan); conditions.push(`plan=$${params.length}`); }
    if (role) { params.push(role); conditions.push(`role=$${params.length}`); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    params.push(limit, offset);

    const result = await query(`
      SELECT u.id, u.name, u.email, u.phone, u.city, u.role, u.plan, u.plan_expires_at,
             u.streak_count, u.reward_points, u.is_active, u.created_at,
             COUNT(DISTINCT up.program_id) as program_count,
             COALESCE(MAX(tr.total_score), 0) as best_score
      FROM users u
      LEFT JOIN user_programs up ON up.user_id=u.id AND up.is_active=true
      LEFT JOIN tryout_results tr ON tr.user_id=u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const total = await query(`SELECT COUNT(*) FROM users ${where}`, countParams);
    res.json({ users: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data user' });
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', async (req, res) => {
  try {
    const { plan, plan_expires_at, is_active, role } = req.body;
    const result = await query(`
      UPDATE users SET
        plan=COALESCE($1,plan),
        plan_expires_at=COALESCE($2,plan_expires_at),
        is_active=COALESCE($3,is_active),
        role=COALESCE($4,role)
      WHERE id=$5 RETURNING id, name, email, plan, is_active, role`,
      [plan, plan_expires_at, is_active, role, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui user' });
  }
});

// GET /api/admin/live-classes
router.get('/live-classes', async (req, res) => {
  try {
    const result = await query(`
      SELECT lc.*, u.name as mentor_name, p.name as program_name
      FROM live_classes lc
      LEFT JOIN users u ON u.id=lc.mentor_id
      LEFT JOIN programs p ON p.id=lc.program_id
      ORDER BY lc.scheduled_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil kelas live' });
  }
});

// POST /api/admin/live-classes
router.post('/live-classes', async (req, res) => {
  try {
    const { program_id, mentor_id, title, description, category_tag,
            zoom_url, scheduled_at, duration_mins } = req.body;

    const result = await query(`
      INSERT INTO live_classes (program_id, mentor_id, title, description, category_tag,
                                zoom_url, scheduled_at, duration_mins)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [program_id, mentor_id, title, description, category_tag, zoom_url, scheduled_at, duration_mins || 60]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat kelas live' });
  }
});

// GET /api/admin/notifications/broadcast
router.post('/notifications/broadcast', async (req, res) => {
  try {
    const { title, message, type, target } = req.body;
    let userIds;

    if (target === 'all') {
      const users = await query("SELECT id FROM users WHERE role='user' AND is_active=true");
      userIds = users.rows.map(r => r.id);
    } else if (target === 'premium') {
      const users = await query("SELECT id FROM users WHERE plan IN ('premium','vip') AND is_active=true");
      userIds = users.rows.map(r => r.id);
    } else if (Array.isArray(target)) {
      userIds = target;
    } else {
      return res.status(400).json({ error: 'Target tidak valid' });
    }

    const inserts = userIds.map((uid, i) =>
      `('${uid}','${title.replace(/'/g,"''")}','${message.replace(/'/g,"''")}','${type || 'info'}')`
    ).join(',');

    if (inserts) {
      await query(`INSERT INTO notifications (user_id, title, message, type) VALUES ${inserts}`);
    }

    res.json({ sent: userIds.length });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengirim notifikasi' });
  }
});

export default router;