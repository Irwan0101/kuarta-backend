import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

router.get('/banners', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM landing_banners WHERE is_active=true ORDER BY order_index ASC LIMIT 5`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat banner' });
  }
});

router.get('/promotions', async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM landing_promotions WHERE is_active=true
       AND (ends_at IS NULL OR ends_at > NOW())
       ORDER BY created_at DESC LIMIT 3`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat promosi' });
  }
});

router.get('/sections', async (req, res) => {
  try {
    const result = await query(`SELECT * FROM landing_sections WHERE is_active=true`);
    const map = {};
    result.rows.forEach(r => { map[r.section_key] = r; });
    res.json(map);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat konten' });
  }
});

router.get('/settings/:key', async (req, res) => {
  try {
    const r = await query('SELECT value FROM admin_settings WHERE key=$1', [req.params.key]);
    res.json(r.rows[0]?.value || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat pengaturan' });
  }
});

export default router;
