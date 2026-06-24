import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/programs/:id/threads', async (req, res) => {
  try {
    console.log('Forum threads for program:', req.params.id);
    const result = await query(`
      SELECT ft.*, u.name as author_name, u.avatar_url, u.role as author_role
      FROM forum_threads ft
      JOIN users u ON u.id=ft.user_id
      WHERE ft.program_id=$1
      ORDER BY ft.is_pinned DESC, ft.created_at DESC
      LIMIT 50`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Forum error:', err.message, err.stack?.slice(0, 200));
    res.status(500).json({ error: err.message || 'Gagal mengambil forum' });
  }
});

router.post('/programs/:id/threads', authenticate, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Judul dan konten harus diisi' });
    const result = await query(`
      INSERT INTO forum_threads (program_id, user_id, title, content)
      VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, req.user.id, title, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat diskusi' });
  }
});

router.get('/threads/:id', async (req, res) => {
  try {
    const thread = await query(`
      SELECT ft.*, u.name as author_name, u.avatar_url, u.role as author_role
      FROM forum_threads ft JOIN users u ON u.id=ft.user_id WHERE ft.id=$1`,
      [req.params.id]
    );
    if (!thread.rows.length) return res.status(404).json({ error: 'Diskusi tidak ditemukan' });
    const replies = await query(`
      SELECT fr.*, u.name as author_name, u.avatar_url, u.role as author_role
      FROM forum_replies fr JOIN users u ON u.id=fr.user_id
      WHERE fr.thread_id=$1 ORDER BY fr.created_at ASC`,
      [req.params.id]
    );
    res.json({ thread: thread.rows[0], replies: replies.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil diskusi' });
  }
});

router.post('/threads/:id/reply', authenticate, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Konten harus diisi' });
    const result = await query(`
      INSERT INTO forum_replies (thread_id, user_id, content) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.user.id, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membalas diskusi' });
  }
});

router.get('/my-threads', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT ft.*, p.name as program_name, p.icon as program_icon,
        (SELECT COUNT(*) FROM forum_replies WHERE thread_id=ft.id) as reply_count
      FROM forum_threads ft
      JOIN programs p ON p.id=ft.program_id
      WHERE ft.user_id=$1
      ORDER BY ft.created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil diskusi saya' });
  }
});

export default router;
