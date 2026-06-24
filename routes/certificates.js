import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/my', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT up.*, p.name as program_name, p.icon as program_icon,
        (SELECT COUNT(*) FROM lessons l WHERE l.program_id=up.program_id) as total_lessons,
        (SELECT COUNT(*) FROM lesson_progress lp
         JOIN lessons l ON l.id=lp.lesson_id
         WHERE l.program_id=up.program_id AND lp.user_id=$1 AND lp.completed=true) as completed_lessons
      FROM user_programs up
      JOIN programs p ON p.id=up.program_id
      WHERE up.user_id=$1 AND up.is_active=true`,
      [req.user.id]
    );
    const certificates = result.rows
      .filter(r => r.completed_lessons >= r.total_lessons && r.total_lessons > 0)
      .map(r => ({
        id: `${r.program_id}-${req.user.id}`,
        program_id: r.program_id,
        program_name: r.program_name,
        program_icon: r.program_icon,
        user_id: req.user.id,
        issued_at: new Date().toISOString(),
      }));
    res.json(certificates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil sertifikat' });
  }
});

export default router;
