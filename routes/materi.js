import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/programs/:id/modules', authenticate, async (req, res) => {
  try {
    const enrolled = await query(
      `SELECT 1 FROM user_programs WHERE user_id=$1 AND program_id=$2 AND is_active=true
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id, req.params.id]
    );
    if (!enrolled.rows.length) return res.status(403).json({ error: 'Kamu belum terdaftar di program ini' });

    const modules = await query(`
      SELECT m.id, m.title, m.icon, m.order_index,
        json_agg(json_build_object(
          'id', l.id, 'title', l.title, 'type', l.type,
          'duration_mins', l.duration_mins, 'order_index', l.order_index,
          'completed', COALESCE(lp.completed, false),
          'watch_seconds', COALESCE(lp.watch_seconds, 0)
        ) ORDER BY l.order_index ASC) FILTER (WHERE l.id IS NOT NULL) AS lessons
      FROM modules m
      LEFT JOIN lessons l ON l.module_id = m.id
      LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.user_id = $2
      WHERE m.program_id = $1
      GROUP BY m.id
      ORDER BY m.order_index ASC
    `, [req.params.id, req.user.id]);

    res.json(modules.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil modul' });
  }
});

router.get('/lessons/:id', authenticate, async (req, res) => {
  try {
    const lesson = await query(`
      SELECT l.*, m.title as module_title, m.icon as module_icon,
             p.name as program_name
      FROM lessons l
      JOIN modules m ON m.id = l.module_id
      JOIN programs p ON p.id = l.program_id
      WHERE l.id = $1`,
      [req.params.id]
    );
    if (!lesson.rows.length) return res.status(404).json({ error: 'Pelajaran tidak ditemukan' });

    const enrolled = await query(
      `SELECT 1 FROM user_programs WHERE user_id=$1 AND program_id=$2 AND is_active=true
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id, lesson.rows[0].program_id]
    );
    if (!enrolled.rows.length) return res.status(403).json({ error: 'Kamu belum terdaftar di program ini' });

    res.json(lesson.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil pelajaran' });
  }
});

router.post('/lessons/:id/progress', authenticate, async (req, res) => {
  try {
    const { completed, watch_seconds } = req.body;
    const lesson = await query('SELECT program_id FROM lessons WHERE id=$1', [req.params.id]);
    if (!lesson.rows.length) return res.status(404).json({ error: 'Pelajaran tidak ditemukan' });

    const enrolled = await query(
      `SELECT 1 FROM user_programs WHERE user_id=$1 AND program_id=$2 AND is_active=true
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.id, lesson.rows[0].program_id]
    );
    if (!enrolled.rows.length) return res.status(403).json({ error: 'Kamu belum terdaftar di program ini' });

    const result = await query(`
      INSERT INTO lesson_progress (user_id, lesson_id, program_id, completed, watch_seconds)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, lesson_id) DO UPDATE SET
        completed = COALESCE($4, lesson_progress.completed),
        watch_seconds = GREATEST(lesson_progress.watch_seconds, COALESCE($5, 0)),
        completed_at = CASE WHEN $4 THEN NOW() ELSE lesson_progress.completed_at END,
        updated_at = NOW()
      RETURNING *`,
      [req.user.id, req.params.id, lesson.rows[0].program_id, completed || false, watch_seconds || 0]
    );

    if (completed) {
      await query('UPDATE users SET reward_points = reward_points + 10 WHERE id=$1', [req.user.id]);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui progres' });
  }
});

export default router;
