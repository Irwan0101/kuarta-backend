import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

router.get('/public', async (req, res) => {
  try {
    const r = await query('SELECT key, value FROM admin_settings');
    const map = {};
    r.rows.forEach(row => { map[row.key] = row.value; });
    res.json(map);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat pengaturan' });
  }
});

export default router;
