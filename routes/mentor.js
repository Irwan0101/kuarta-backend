import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.name, u.email, u.avatar_url, u.photo_url, u.city, u.bio, u.reward_points,
             u.specialization, u.schedule,
        (SELECT COUNT(*) FROM live_classes WHERE mentor_id=u.id) as total_classes,
        (SELECT COUNT(*) FROM user_programs up
         JOIN lessons l ON l.program_id=up.program_id
         JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=up.user_id
         WHERE up.program_id IS NOT NULL) as total_students
      FROM users u WHERE u.role='mentor' ORDER BY u.name`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil mentor' });
  }
});

router.get('/:id/schedule', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT lc.*, p.name as program_name
      FROM live_classes lc
      JOIN programs p ON p.id=lc.program_id
      WHERE lc.mentor_id=$1 AND lc.scheduled_at > NOW() - INTERVAL '1 day'
      ORDER BY lc.scheduled_at ASC LIMIT 20`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil jadwal mentor' });
  }
});

router.post('/sessions', authenticate, async (req, res) => {
  try {
    const { mentor_id, program_id, date, time, topic } = req.body;
    const result = await query(`
      INSERT INTO mentoring_sessions (user_id, mentor_id, program_id, scheduled_at, topic)
      VALUES ($1,$2,$3,$4::date + $5::time, $6) RETURNING *`,
      [req.user.id, mentor_id, program_id, date, time, topic]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat sesi mentoring' });
  }
});

router.get('/my-sessions', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT ms.*, u.name as mentor_name, u.avatar_url as mentor_avatar,
             COALESCE(p.name, '(Program tidak tersedia)') as program_name
      FROM mentoring_sessions ms
      JOIN users u ON u.id=ms.mentor_id
      LEFT JOIN programs p ON p.id=ms.program_id
      WHERE ms.user_id=$1
      ORDER BY ms.scheduled_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil sesi mentoring' });
  }
});

router.put('/sessions/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    const result = await query(
      `UPDATE mentoring_sessions SET status=$1 WHERE id=$2 AND (user_id=$3 OR mentor_id=$3) RETURNING *`,
      [status, req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui sesi' });
  }
});

export default router;
