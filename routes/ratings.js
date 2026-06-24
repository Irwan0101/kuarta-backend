import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/programs/:id/rate', authenticate, async (req, res) => {
  try {
    const { rating, review } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating harus 1-5' });
    }
    const enrolled = await query(
      `SELECT 1 FROM user_programs WHERE user_id=$1 AND program_id=$2`,
      [req.user.id, req.params.id]
    );
    if (!enrolled.rows.length) {
      return res.status(403).json({ error: 'Kamu belum terdaftar di program ini' });
    }
    const result = await query(`
      INSERT INTO program_reviews (user_id, program_id, rating, review)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (user_id, program_id) DO UPDATE SET rating=$3, review=$4, updated_at=NOW()
      RETURNING *`,
      [req.user.id, req.params.id, rating, review || null]
    );
    await query(`
      UPDATE programs SET
        rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM program_reviews WHERE program_id=$1),
        review_count = (SELECT COUNT(*) FROM program_reviews WHERE program_id=$1)
      WHERE id=$1`,
      [req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memberikan rating' });
  }
});

router.get('/programs/:id/reviews', async (req, res) => {
  try {
    const result = await query(`
      SELECT pr.*, u.name as user_name, u.avatar_url
      FROM program_reviews pr
      JOIN users u ON u.id=pr.user_id
      WHERE pr.program_id=$1
      ORDER BY pr.created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil ulasan' });
  }
});

export default router;
