import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin, requireMentor } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';

const router = Router();

// Public: list all mentors
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.name, u.email, u.avatar_url, u.photo_url, u.city, u.bio, u.reward_points,
             u.specialization, u.schedule,
        (SELECT COUNT(*) FROM live_classes WHERE mentor_id=u.id) as total_classes,
        (SELECT COUNT(*) FROM mentoring_sessions WHERE mentor_id=u.id AND status='completed') as total_students
      FROM users u WHERE u.role='mentor' ORDER BY u.name`,
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil mentor' });
  }
});

// Mentor: my schedule
router.get('/my-schedule', authenticate, requireMentor, async (req, res) => {
  try {
    const [live, sessions] = await Promise.all([
      query(`
        SELECT lc.*, p.name as program_name
        FROM live_classes lc JOIN programs p ON p.id=lc.program_id
        WHERE lc.mentor_id=$1 AND lc.scheduled_at > NOW() - INTERVAL '1 day'
        ORDER BY lc.scheduled_at ASC LIMIT 20`,
        [req.user.id]
      ),
      query(`
        SELECT ms.*, u.name as user_name, u.avatar_url as user_avatar
        FROM mentoring_sessions ms JOIN users u ON u.id=ms.user_id
        WHERE ms.mentor_id=$1 AND ms.scheduled_at > NOW() - INTERVAL '1 day'
        ORDER BY ms.scheduled_at ASC LIMIT 20`,
        [req.user.id]
      ),
    ]);
    res.json({ liveClasses: live.rows, sessions: sessions.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil jadwal' });
  }
});

// Mentor: my students
router.get('/students', authenticate, requireMentor, async (req, res) => {
  try {
    const result = await query(`
      SELECT DISTINCT u.id, u.name, u.email, u.avatar_url, u.phone, u.city,
        (SELECT COUNT(*) FROM mentoring_sessions WHERE mentor_id=$1 AND user_id=u.id AND status='completed') as total_sessions,
        (SELECT MAX(scheduled_at) FROM mentoring_sessions WHERE mentor_id=$1 AND user_id=u.id) as last_session
      FROM mentoring_sessions ms JOIN users u ON u.id=ms.user_id
      WHERE ms.mentor_id=$1 ORDER BY last_session DESC NULLS LAST`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil siswa' });
  }
});

// Mentor: my sessions
router.get('/sessions', authenticate, requireMentor, async (req, res) => {
  try {
    const result = await query(`
      SELECT ms.*, u.name as user_name, u.avatar_url as user_avatar, u.phone as user_phone,
             COALESCE(p.name, '(Program tidak tersedia)') as program_name
      FROM mentoring_sessions ms
      JOIN users u ON u.id=ms.user_id
      LEFT JOIN programs p ON p.id=ms.program_id
      WHERE ms.mentor_id=$1
      ORDER BY ms.scheduled_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil sesi' });
  }
});

// Mentor: get profile
router.get('/profile', authenticate, requireMentor, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, email, avatar_url, photo_url, city, bio, specialization, schedule, phone
       FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Mentor tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil profil' });
  }
});

// Mentor: update profile
router.put('/profile', authenticate, requireMentor, async (req, res) => {
  try {
    const { name, phone, city, bio, specialization, photo_url, schedule } = req.body;
    const result = await query(
      `UPDATE users SET
        name=COALESCE($1,name), phone=COALESCE($2,phone), city=COALESCE($3,city),
        bio=COALESCE($4,bio), specialization=COALESCE($5::text[],specialization),
        photo_url=COALESCE($6,photo_url), schedule=COALESCE($7::jsonb,schedule)
       WHERE id=$8 AND role='mentor'
       RETURNING id,name,email,avatar_url,photo_url,city,bio,specialization,schedule,phone`,
      [name, phone, city, bio, specialization ? specialization : null, photo_url, schedule ? JSON.stringify(schedule) : null, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Mentor tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui profil' });
  }
});

// Student: view my sessions
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

// Student: book a session
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

// Both: update session status
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

// Public: get a mentor's schedule (by id)
router.get('/:id/schedule', async (req, res) => {
  try {
    const result = await query(`
      SELECT lc.*, p.name as program_name
      FROM live_classes lc JOIN programs p ON p.id=lc.program_id
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

export default router;
