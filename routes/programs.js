import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin, optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/programs
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = `
      SELECT p.*,
        CASE WHEN up.user_id IS NOT NULL THEN true ELSE false END as is_enrolled
      FROM programs p
      LEFT JOIN user_programs up ON up.program_id=p.id AND up.user_id=$1 AND up.is_active=true
      WHERE p.is_active=true
    `;
    const params = [req.user?.id || null];
    if (category && category !== 'all') {
      params.push(category);
      sql += ` AND p.category=$${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`;
    }
    sql += ' ORDER BY p.is_featured DESC, p.student_count DESC';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil program' });
  }
});

// GET /api/programs/:slug
router.get('/:slug', optionalAuth, async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*,
        CASE WHEN up.user_id IS NOT NULL THEN true ELSE false END as is_enrolled,
        up.enrolled_at, up.expires_at
      FROM programs p
      LEFT JOIN user_programs up ON up.program_id=p.id AND up.user_id=$1 AND up.is_active=true
      WHERE p.slug=$2 AND p.is_active=true`,
      [req.user?.id || null, req.params.slug]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Program tidak ditemukan' });

    const program = result.rows[0];

    // Modules & lessons
    const modules = await query(
      'SELECT * FROM modules WHERE program_id=$1 ORDER BY order_index',
      [program.id]
    );

    for (const mod of modules.rows) {
      const lessons = await query(
        'SELECT * FROM lessons WHERE module_id=$1 ORDER BY order_index',
        [mod.id]
      );
      mod.lessons = lessons.rows;

      // Progress if authenticated
      if (req.user?.id) {
        const progress = await query(
          'SELECT lesson_id, completed FROM lesson_progress WHERE user_id=$1 AND module_id=$2',
          [req.user.id, mod.id]
        );
        const progressMap = {};
        progress.rows.forEach(p => progressMap[p.lesson_id] = p.completed);
        mod.lessons = mod.lessons.map(l => ({ ...l, completed: progressMap[l.id] || false }));
      }
    }

    program.modules = modules.rows;
    res.json(program);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil detail program' });
  }
});

// GET /api/programs/user/enrolled
router.get('/user/enrolled', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, up.enrolled_at, up.expires_at,
        COALESCE(
          ROUND(
            COUNT(DISTINCT lp.lesson_id) * 100.0 / NULLIF(COUNT(DISTINCT l.id), 0)
          )::int, 0
        ) as progress_pct,
        COUNT(DISTINCT l.id) as total_lessons,
        COUNT(DISTINCT lp.lesson_id) as completed_lessons
      FROM user_programs up
      JOIN programs p ON p.id=up.program_id
      LEFT JOIN lessons l ON l.program_id=p.id
      LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$1 AND lp.completed=true
      WHERE up.user_id=$1 AND up.is_active=true
      GROUP BY p.id, up.enrolled_at, up.expires_at
      ORDER BY up.enrolled_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil program terdaftar' });
  }
});

// POST /api/programs (admin)
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { slug, name, category, price, duration_months, description, icon, bg_gradient,
            badge_label, badge_type, video_count, pdf_count, tryout_count } = req.body;

    const result = await query(`
      INSERT INTO programs (slug,name,category,price,duration_months,description,icon,
                            bg_gradient,badge_label,badge_type,video_count,pdf_count,tryout_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [slug, name, category, price, duration_months, description, icon,
       bg_gradient, badge_label, badge_type, video_count||0, pdf_count||0, tryout_count||0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug sudah digunakan' });
    res.status(500).json({ error: 'Gagal membuat program' });
  }
});

// PUT /api/programs/:id (admin)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const fields = ['name','category','price','duration_months','description','icon',
                    'bg_gradient','badge_label','badge_type','is_active','is_featured'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        values.push(req.body[f]);
        updates.push(`${f}=$${values.length}`);
      }
    });
    if (!updates.length) return res.status(400).json({ error: 'Tidak ada field yang diperbarui' });
    values.push(req.params.id);
    const result = await query(
      `UPDATE programs SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui program' });
  }
});

// POST /api/programs/:id/progress (mark lesson done)
router.post('/:id/progress', authenticate, async (req, res) => {
  try {
    const { lesson_id, completed, watch_seconds } = req.body;
    const result = await query(`
      INSERT INTO lesson_progress (user_id, lesson_id, program_id, completed, watch_seconds, completed_at)
      VALUES ($1,$2,$3,$4,$5,CASE WHEN $4 THEN NOW() ELSE NULL END)
      ON CONFLICT (user_id, lesson_id) DO UPDATE
        SET completed=$4, watch_seconds=GREATEST(lesson_progress.watch_seconds, $5),
            completed_at=CASE WHEN $4 THEN COALESCE(lesson_progress.completed_at, NOW()) ELSE NULL END,
            updated_at=NOW()
      RETURNING *`,
      [req.user.id, lesson_id, req.params.id, completed || false, watch_seconds || 0]
    );

    // Award points for completing lesson
    if (completed) {
      await query('UPDATE users SET reward_points=reward_points+10 WHERE id=$1', [req.user.id]);
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan progres' });
  }
});

export default router;