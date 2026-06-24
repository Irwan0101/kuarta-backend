import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// GET /api/live
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT lc.*, u.name as mentor_name, p.name as program_name, p.icon as program_icon
      FROM live_classes lc
      LEFT JOIN users u ON u.id=lc.mentor_id
      LEFT JOIN programs p ON p.id=lc.program_id
      WHERE lc.scheduled_at >= NOW()-INTERVAL '2 hours'
        AND EXISTS (
          SELECT 1 FROM user_programs up
          WHERE up.program_id=lc.program_id AND up.user_id=$1 AND up.is_active=true
          AND (up.expires_at IS NULL OR up.expires_at > NOW())
        )
      ORDER BY lc.scheduled_at ASC LIMIT 20`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil kelas live' });
  }
});

// GET /api/live/recordings
router.get('/recordings', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT lc.*, u.name as mentor_name, p.name as program_name
      FROM live_classes lc
      LEFT JOIN users u ON u.id=lc.mentor_id
      LEFT JOIN programs p ON p.id=lc.program_id
      WHERE lc.is_recorded=true AND lc.recording_url IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM user_programs up
          WHERE up.program_id=lc.program_id AND up.user_id=$1 AND up.is_active=true
          AND (up.expires_at IS NULL OR up.expires_at > NOW())
        )
      ORDER BY lc.scheduled_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil rekaman' });
  }
});

export default router;
