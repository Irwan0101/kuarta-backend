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

router.get('/programs', async (req, res) => {
  try {
    const sec = await query(`SELECT content FROM landing_sections WHERE section_key='programs' AND is_active=true LIMIT 1`);
    const content = sec.rows[0]?.content || {};
    const selectedIds = content.selected_ids || [];
    let result;
    if (selectedIds.length > 0) {
      result = await query(
        `SELECT id, slug, name, category, icon, bg_gradient, price, duration_months,
                video_count, tryout_count, rating, badge_label, badge_type
         FROM programs WHERE is_active=true AND id = ANY($1)
         ORDER BY array_position($1, id)`,
        [selectedIds]
      );
    } else {
      result = await query(
        `SELECT id, slug, name, category, icon, bg_gradient, price, duration_months,
                video_count, tryout_count, rating, badge_label, badge_type
         FROM programs WHERE is_active=true ORDER BY name`
      );
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat program' });
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
