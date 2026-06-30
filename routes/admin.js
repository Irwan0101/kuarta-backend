import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import mammoth from 'mammoth';
import { exec } from 'child_process';
import fs from 'fs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } from 'docx';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { validate, schemas } from '../middleware/validate.js';

const router = Router();
router.use(authenticate, requireAdmin);
const upload = multer({ storage: multer.memoryStorage() });

/* ══════════════════════════════════════════════════════════════════
   STATS
══════════════════════════════════════════════════════════════════ */

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [users, revenue, programs, tryouts, activeSessions, newToday] = await Promise.all([
      query(`SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE plan='premium' OR plan='vip') as premium,
        COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '30 days') as new_this_month
       FROM users WHERE role='user'`),

      query(`SELECT
        COALESCE(SUM(gross_amount) FILTER (WHERE status='success'), 0) as total_revenue,
        COALESCE(SUM(gross_amount) FILTER (WHERE status='success' AND paid_at >= NOW()-INTERVAL '30 days'), 0) as monthly_revenue,
        COUNT(*) FILTER (WHERE status='success') as total_transactions,
        COUNT(*) FILTER (WHERE status='pending') as pending_transactions
       FROM transactions`),

      query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active) as active FROM programs`),

      // FIX: pakai tryout_packages, bukan tryouts
      query(`SELECT COUNT(*) as total FROM tryout_packages`),

      // FIX: pakai tryout_results, bukan tryout_sessions
      // Sesi aktif = tryout yang started_at dalam 2 jam terakhir dan belum selesai
      query(`SELECT COUNT(*) as total FROM tryout_results
             WHERE started_at >= NOW()-INTERVAL '2 hours' AND finished_at IS NULL`),

      query(`SELECT COUNT(*) as total FROM users
             WHERE role='user' AND created_at >= CURRENT_DATE`),
    ]);

    const trend = await query(`
      SELECT DATE_TRUNC('month', paid_at) as month,
             SUM(gross_amount) as revenue,
             COUNT(*) as count
      FROM transactions
      WHERE status='success' AND paid_at >= NOW()-INTERVAL '6 months'
      GROUP BY 1 ORDER BY 1`
    );

    // FIX: pakai tryout_packages, bukan programs join tryouts
    const topPrograms = await query(`
      SELECT p.name, p.icon, COUNT(t.id) as sales, SUM(t.gross_amount) as revenue
      FROM transactions t JOIN programs p ON p.id = t.program_id
      WHERE t.status='success'
      GROUP BY p.id, p.name, p.icon
      ORDER BY revenue DESC LIMIT 5`
    );

    res.json({
      total_users:          parseInt(users.rows[0].total),
      premium_users:        parseInt(users.rows[0].premium),
      new_this_month:       parseInt(users.rows[0].new_this_month),
      new_users_today:      parseInt(newToday.rows[0].total),
      total_programs:       parseInt(programs.rows[0].total),
      active_programs:      parseInt(programs.rows[0].active),
      total_tryouts:        parseInt(tryouts.rows[0].total),
      active_sessions:      parseInt(activeSessions.rows[0].total),
      total_revenue:        parseFloat(revenue.rows[0].total_revenue),
      monthly_revenue:      parseFloat(revenue.rows[0].monthly_revenue),
      total_transactions:   parseInt(revenue.rows[0].total_transactions),
      pending_transactions: parseInt(revenue.rows[0].pending_transactions),
      trend:                trend.rows,
      top_programs:         topPrograms.rows,
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Gagal mengambil statistik' });
  }
});

const PERIOD_MAP = {
  '7d':  { interval: '7 days',   trunc: 'day'   },
  '30d': { interval: '30 days',  trunc: 'day'   },
  '90d': { interval: '90 days',  trunc: 'week'  },
  '1m':  { interval: '1 month',  trunc: 'day'   },
  '3m':  { interval: '3 months', trunc: 'week'  },
  '6m':  { interval: '6 months', trunc: 'month' },
  '1y':  { interval: '1 year',   trunc: 'month' },
};

// GET /api/admin/revenue?period=7d|30d|90d|6m|3m|1m|1y
router.get('/revenue', async (req, res) => {
  try {
    const period = typeof req.query.period === 'string' ? req.query.period : '7d';
    const config = PERIOD_MAP[period] || PERIOD_MAP['7d'];
    const trunc = config.trunc;
    const truncStep = trunc === 'week' ? 'week' : trunc === 'month' ? 'month' : 'day';

    const result = await query(`
      SELECT
        DATE_TRUNC($1::text, gs.d)::date AS date,
        COALESCE(SUM(t.gross_amount), 0) AS amount,
        COUNT(t.id) AS user_count
      FROM generate_series(
        (NOW() - $2::interval)::date,
        NOW()::date,
        ('1 ' || $3::text)::interval
      ) AS gs(d)
      LEFT JOIN transactions t
        ON DATE_TRUNC($1::text, t.paid_at) = DATE_TRUNC($1::text, gs.d)
        AND t.status = 'success'
      GROUP BY 1
      ORDER BY 1`,
      [trunc, config.interval, truncStep]
    );

    const rows = result.rows.map(r => ({
      ...r,
      amount:     parseFloat(r.amount),
      user_count: parseInt(r.user_count),
      label: new Date(r.date).toLocaleDateString('id-ID', {
        day:   trunc === 'month' ? undefined : 'numeric',
        month: 'short',
        year:  trunc === 'month' ? 'numeric' : undefined,
      }),
    }));

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data revenue' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   USERS
══════════════════════════════════════════════════════════════════ */

router.post('/users', audit('create_user', 'user'), validate(schemas.createUser), async (req, res) => {
  try {
    const { name, email, password, role, plan } = req.body;
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role, plan, email_verified) VALUES ($1,$2,$3,$4,$5,true) RETURNING id,name,email,role,plan,created_at`,
      [name, email.toLowerCase().trim(), hash.toString(), role || 'user', plan || 'free']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email sudah terdaftar' });
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat user' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const { search, plan, role, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = ["role != 'admin'"];

    if (search) { params.push(`%${search}%`); conditions.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`); }
    if (plan)   { params.push(plan);           conditions.push(`plan=$${params.length}`); }
    if (role)   { params.push(role);           conditions.push(`role=$${params.length}`); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    params.push(limit, offset);

    // FIX: best_score dari tryout_results.total_score
    const result = await query(`
      SELECT u.id, u.name, u.email, u.phone, u.city, u.role, u.plan, u.plan_expires_at,
             u.streak_count, u.reward_points, u.is_active, u.created_at,
             COUNT(DISTINCT up.program_id) as program_count,
             COALESCE(MAX(tr.total_score), 0) as best_score
      FROM users u
      LEFT JOIN user_programs up ON up.user_id=u.id AND up.is_active=true
      LEFT JOIN tryout_results tr ON tr.user_id=u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const total = await query(`SELECT COUNT(*) FROM users ${where}`, countParams);
    res.json({ users: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data user' });
  }
});

router.put('/users/:id', audit('update_user', 'user'), async (req, res) => {
  try {
    if (req.params.id === req.user.id && req.body.role && req.body.role !== 'admin') {
      return res.status(400).json({ error: 'Tidak bisa menurunkan role sendiri' });
    }
    const { plan, plan_expires_at, is_active, role } = req.body;
    const result = await query(`
      UPDATE users SET
        plan            = COALESCE($1, plan),
        plan_expires_at = COALESCE($2, plan_expires_at),
        is_active       = COALESCE($3, is_active),
        role            = COALESCE($4, role),
        updated_at      = NOW()
      WHERE id = $5
      RETURNING id, name, email, plan, is_active, role`,
      [plan, plan_expires_at, is_active, role, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui user' });
  }
});

router.patch('/users/:id/ban', async (req, res) => {
  try {
    const result = await query(`
      UPDATE users
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id = $1 AND role != 'admin'
      RETURNING id, name, email, is_active`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal ban/unban user' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   PROGRAMS
══════════════════════════════════════════════════════════════════ */

router.get('/programs', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*,
        COUNT(DISTINCT up.user_id) as enrolled_count,
        COALESCE(SUM(t.gross_amount) FILTER (WHERE t.status='success'), 0) as total_revenue
      FROM programs p
      LEFT JOIN user_programs up ON up.program_id = p.id AND up.is_active = true
      LEFT JOIN transactions t ON t.program_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil program' });
  }
});

router.post('/programs', audit('create_program', 'program'), validate(schemas.createProgram), async (req, res) => {
  try {
    const {
      slug, name, category, subcategory, description,
      price, duration_months, icon, is_active = true,
      thumbnail_url, bg_gradient, is_featured,
      badge_label, badge_type, pricing_type,
      session_price, session_count
    } = req.body;
    const result = await query(`
      INSERT INTO programs
        (slug, name, category, subcategory, description, price, duration_months,
         icon, thumbnail_url, bg_gradient, is_featured, is_active, badge_label, badge_type,
         pricing_type, session_price, session_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [slug, name, category, subcategory, description, price, duration_months || 1,
       icon || '📚', thumbnail_url, bg_gradient, is_featured || false, is_active,
       badge_label, badge_type, pricing_type || 'bundle', session_price || null, session_count || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat program' });
  }
});

router.put('/programs/:id', audit('update_program', 'program'), async (req, res) => {
  try {
    const {
      name, description, icon, price, duration_months,
      is_active, thumbnail_url, bg_gradient, is_featured,
      badge_label, badge_type, pricing_type,
      session_price, session_count
    } = req.body;
    const result = await query(`
      UPDATE programs SET
        name            = COALESCE($1, name),
        description     = COALESCE($2, description),
        icon            = COALESCE($3, icon),
        price           = COALESCE($4, price),
        duration_months = COALESCE($5, duration_months),
        is_active       = COALESCE($6, is_active),
        thumbnail_url   = COALESCE($7, thumbnail_url),
        bg_gradient     = COALESCE($8, bg_gradient),
        is_featured     = COALESCE($9, is_featured),
        badge_label     = COALESCE($10, badge_label),
        badge_type      = COALESCE($11, badge_type),
        pricing_type    = COALESCE($12, pricing_type),
        session_price   = COALESCE($13, session_price),
        session_count   = COALESCE($14, session_count),
        updated_at      = NOW()
      WHERE id = $15
      RETURNING *`,
      [name, description, icon, price, duration_months, is_active,
       thumbnail_url, bg_gradient, is_featured, badge_label, badge_type,
       pricing_type, session_price, session_count, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Program tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui program' });
  }
});

router.delete('/programs/:id', audit('delete_program', 'program'), async (req, res) => {
  try {
    const result = await query(`
      UPDATE programs SET is_active = false, updated_at = NOW()
      WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Program tidak ditemukan' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus program' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   TRYOUTS — FIX: semua pakai tryout_packages, bukan tryouts
══════════════════════════════════════════════════════════════════ */

router.get('/tryouts', async (req, res) => {
  try {
    const { program } = req.query;
    const params = [];
    let where = '';
    if (program) { params.push(program); where = `WHERE tp.program_id = $1`; }

    const result = await query(`
      SELECT tp.*, p.name as program_name,
        COUNT(DISTINCT q.id)  as question_count,
        COUNT(DISTINCT tr.id) as attempt_count
      FROM tryout_packages tp
      LEFT JOIN programs p       ON p.id  = tp.program_id
      LEFT JOIN questions q      ON q.tryout_id = tp.id
      LEFT JOIN tryout_results tr ON tr.tryout_id = tp.id
      ${where}
      GROUP BY tp.id, p.name
      ORDER BY tp.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil tryout' });
  }
});

router.post('/tryouts', async (req, res) => {
  try {
    // FIX: kolom sesuai tryout_packages (duration_mins, passing_score, type, question_count)
    const {
      program_id, title, type = 'full',
      question_count, duration_mins, passing_score, is_active = true
    } = req.body;
    const result = await query(`
      INSERT INTO tryout_packages
        (program_id, title, type, question_count, duration_mins, passing_score, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [program_id, title, type, question_count || 110, duration_mins || 100, passing_score || 311, is_active]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat tryout' });
  }
});

router.put('/tryouts/:id', async (req, res) => {
  try {
    const { title, duration_mins, passing_score, is_active, question_count } = req.body;
    const result = await query(`
      UPDATE tryout_packages SET
        title          = COALESCE($1, title),
        duration_mins  = COALESCE($2, duration_mins),
        passing_score  = COALESCE($3, passing_score),
        is_active      = COALESCE($4, is_active),
        question_count = COALESCE($5, question_count)
      WHERE id = $6
      RETURNING *`,
      [title, duration_mins, passing_score, is_active, question_count, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tryout tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui tryout' });
  }
});

router.delete('/tryouts/:id', async (req, res) => {
  try {
    const result = await query(`DELETE FROM tryout_packages WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Tryout tidak ditemukan' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus tryout' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   QUESTIONS — FIX: kolom sesuai migration (option_a/b/c/d/e, score_value, order_index)
══════════════════════════════════════════════════════════════════ */

router.get('/tryouts/:id/questions', async (req, res) => {
  try {
    const result = await query(`
      SELECT q.*
      FROM questions q
      LEFT JOIN tryout_questions tq ON tq.question_id = q.id
      WHERE q.tryout_id = $1 OR tq.tryout_id = $1
      ORDER BY COALESCE(tq.order_index, q.order_index), q.created_at`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil soal' });
  }
});

router.post('/tryouts/:id/questions', async (req, res) => {
  try {
    const {
      question_text, option_a, option_b, option_c, option_d, option_e,
      correct_answer, explanation, category, difficulty,
      order_index, score_value = 5,
      group_id, time_limit_secs
    } = req.body;
    const result = await query(`
      INSERT INTO questions
        (tryout_id, question_text, option_a, option_b, option_c, option_d, option_e,
         correct_answer, explanation, category, difficulty, order_index, score_value,
         group_id, time_limit_secs)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [req.params.id, question_text, option_a, option_b, option_c, option_d, option_e,
       correct_answer, explanation, category, difficulty || 'medium', order_index || 0, score_value,
       group_id || null, time_limit_secs || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambah soal' });
  }
});

router.put('/questions/:id', async (req, res) => {
  try {
    const {
      question_text, option_a, option_b, option_c, option_d, option_e,
      correct_answer, explanation, category, difficulty, order_index, score_value,
      group_id, time_limit_secs
    } = req.body;
    const result = await query(`
      UPDATE questions SET
        question_text  = COALESCE($1,  question_text),
        option_a       = COALESCE($2,  option_a),
        option_b       = COALESCE($3,  option_b),
        option_c       = COALESCE($4,  option_c),
        option_d       = COALESCE($5,  option_d),
        option_e       = COALESCE($6,  option_e),
        correct_answer = COALESCE($7,  correct_answer),
        explanation    = COALESCE($8,  explanation),
        category       = COALESCE($9,  category),
        difficulty     = COALESCE($10, difficulty),
        order_index    = COALESCE($11, order_index),
        score_value    = COALESCE($12, score_value),
        group_id       = COALESCE($13, group_id),
        time_limit_secs = COALESCE($14, time_limit_secs)
      WHERE id = $15
      RETURNING *`,
      [question_text, option_a, option_b, option_c, option_d, option_e,
       correct_answer, explanation, category, difficulty, order_index, score_value,
       group_id || null, time_limit_secs || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Soal tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui soal' });
  }
});

router.delete('/questions/:id', async (req, res) => {
  try {
    const result = await query(`DELETE FROM questions WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Soal tidak ditemukan' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus soal' });
  }
});

/* ── Bank Soal (all questions with filters) ── */

router.get('/questions', async (req, res) => {
  try {
    const { program_id, category, search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions = [];
    const params = [];
    let idx = 1;

    if (program_id) {
      conditions.push(`tp.program_id = $${idx++}`);
      params.push(program_id);
    }
    if (category) {
      conditions.push(`q.category = $${idx++}`);
      params.push(category);
    }
    if (search) {
      conditions.push(`q.question_text ILIKE $${idx++}`);
      params.push(`%${search}%`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await query(`
      SELECT COUNT(*) FROM questions q
      LEFT JOIN tryout_packages tp ON tp.id = q.tryout_id
      ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    let result;
    try {
      result = await query(`
        SELECT q.*, tp.title as tryout_title, p.name as program_name,
          qg.title as group_title
        FROM questions q
        LEFT JOIN tryout_packages tp ON tp.id = q.tryout_id
        LEFT JOIN programs p ON p.id = tp.program_id
        LEFT JOIN question_groups qg ON qg.id = q.group_id
        ${where}
        ORDER BY q.created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, Number(limit), offset]
      );
    } catch (e) {
      if (e.message?.includes('relation "question_groups" does not exist')) {
        idx = params.length + 1;
        result = await query(`
          SELECT q.*, tp.title as tryout_title, p.name as program_name
          FROM questions q
          LEFT JOIN tryout_packages tp ON tp.id = q.tryout_id
          LEFT JOIN programs p ON p.id = tp.program_id
          ${where}
          ORDER BY q.created_at DESC
          LIMIT $${idx++} OFFSET $${idx++}`,
          [...params, Number(limit), offset]
        );
      } else {
        throw e;
      }
    }

    res.json({ questions: result.rows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil soal' });
  }
});

/* ── Bank Soal Import ── */

router.post('/questions/import', async (req, res) => {
  try {
    const { questions } = req.body;
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ error: 'Tidak ada soal untuk diimport' });
    }
    const imported = [];
    for (const q of questions) {
      if (!q.question_text || !q.option_a || !q.option_b || !q.option_c || !q.option_d || !q.correct_answer) continue;
      const result = await query(`
        INSERT INTO questions (question_text, option_a, option_b, option_c, option_d, option_e,
          correct_answer, explanation, category, difficulty)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.option_e || null,
         q.correct_answer, q.explanation || null, q.category || 'TIU', q.difficulty || 'medium']
      );
      imported.push(result.rows[0]);
    }
    res.status(201).json({ imported: imported.length, questions: imported });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal import soal' });
  }
});

/* ── Import .docx ── */

function parseDocxQuestions(text) {
  const questions = [];
  const blocks = text.split(/\n\s*(?:Soal|Nomor)\s*\d+\s*[:.]?\s*/i).filter(b => b.trim());
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    let question_text = '', option_a = '', option_b = '', option_c = '', option_d = '', option_e = '';
    let correct_answer = '', explanation = '', category = 'TIU';
    let capture = 'question';
    for (const line of lines) {
      const optMatch = line.match(/^([A-E])[.．)]\s*(.*)/);
      if (optMatch) {
        const opt = optMatch[1].toLowerCase();
        const val = optMatch[2];
        if (opt === 'a') { option_a = val; capture = 'options'; }
        else if (opt === 'b') option_b = val;
        else if (opt === 'c') option_c = val;
        else if (opt === 'd') option_d = val;
        else if (opt === 'e') option_e = val;
      } else if (/^jawaban\s*[:：]/i.test(line)) {
        correct_answer = line.replace(/^jawaban\s*[:：]\s*/i, '').trim().toLowerCase().charAt(0);
      } else if (/^kategori\s*[:：]/i.test(line)) {
        category = line.replace(/^kategori\s*[:：]\s*/i, '').trim().toUpperCase();
        if (!['TWK','TIU','TKP','PU','PM','LBI','LBE','PBM'].includes(category)) category = 'TIU';
      } else if (/^pembahasan\s*[:：]/i.test(line)) {
        explanation = line.replace(/^pembahasan\s*[:：]\s*/i, '').trim();
      } else if (capture === 'question') {
        question_text += (question_text ? ' ' : '') + line;
      }
    }
    if (question_text && option_a && option_b && option_c && option_d && correct_answer) {
      questions.push({ question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, explanation, category });
    }
  }
  return questions;
}

router.post('/questions/import/docx', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload file .docx' });
    const result = await mammoth.extractRawText({ buffer: req.file.buffer });
    const questions = parseDocxQuestions(result.value);
    if (!questions.length) return res.status(400).json({ error: 'Tidak ditemukan soal dalam format yang sesuai' });
    const imported = [];
    for (const q of questions) {
      const r = await query(`
        INSERT INTO questions (question_text, option_a, option_b, option_c, option_d, option_e,
          correct_answer, explanation, category, difficulty)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.option_e || null,
         q.correct_answer, q.explanation || null, q.category || 'TIU', 'medium']
      );
      imported.push(r.rows[0]);
    }
    res.json({ imported: imported.length, questions: imported });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal import file' });
  }
});

/* ── Assign Bank Questions to Tryout ── */

router.post('/tryouts/:id/questions/link', async (req, res) => {
  try {
    const { question_ids } = req.body;
    if (!Array.isArray(question_ids) || !question_ids.length) {
      return res.status(400).json({ error: 'Pilih soal yang akan ditambahkan' });
    }
    let added = 0;
    for (const qid of question_ids) {
      const existing = await query('SELECT 1 FROM tryout_questions WHERE tryout_id=$1 AND question_id=$2', [req.params.id, qid]);
      if (existing.rows.length) continue;
      await query('INSERT INTO tryout_questions (tryout_id, question_id) VALUES ($1,$2)', [req.params.id, qid]);
      added++;
    }
    // Also update tryout_packages.question_count
    const cnt = await query('SELECT COUNT(*) FROM tryout_questions WHERE tryout_id=$1', [req.params.id]);
    await query('UPDATE tryout_packages SET question_count=$1 WHERE id=$2', [cnt.rows[0].count, req.params.id]);
    res.json({ added, total: Number(cnt.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambahkan soal' });
  }
});

router.delete('/tryouts/:id/questions/link', async (req, res) => {
  try {
    const { question_ids } = req.body;
    if (!Array.isArray(question_ids) || !question_ids.length) {
      return res.status(400).json({ error: 'Pilih soal yang akan dihapus' });
    }
    const result = await query(
      'DELETE FROM tryout_questions WHERE tryout_id=$1 AND question_id=ANY($2::uuid[])',
      [req.params.id, question_ids]
    );
    // Update tryout_packages.question_count
    const cnt = await query('SELECT COUNT(*) FROM tryout_questions WHERE tryout_id=$1', [req.params.id]);
    await query('UPDATE tryout_packages SET question_count=$1 WHERE id=$2', [cnt.rows[0].count, req.params.id]);
    res.json({ deleted: result.rowCount, total: Number(cnt.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus soal' });
  }
});

router.get('/tryouts/:id/question-links', async (req, res) => {
  try {
    const result = await query(`
      SELECT q.id, q.question_text, q.category, q.correct_answer, q.difficulty, tq.order_index
      FROM tryout_questions tq
      JOIN questions q ON q.id = tq.question_id
      WHERE tq.tryout_id=$1
      ORDER BY tq.order_index`, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat soal' });
  }
});

/* ── Question Groups ── */

router.get('/question-groups', async (req, res) => {
  try {
    const result = await query(`
      SELECT qg.*, COUNT(q.id) as question_count
      FROM question_groups qg
      LEFT JOIN questions q ON q.group_id = qg.id
      GROUP BY qg.id
      ORDER BY qg.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil kelompok soal' });
  }
});

router.post('/question-groups', async (req, res) => {
  try {
    const { title, description, stimulus } = req.body;
    const result = await query(
      `INSERT INTO question_groups (title, description, stimulus) VALUES ($1,$2,$3) RETURNING *`,
      [title, description || null, stimulus || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat kelompok soal' });
  }
});

router.put('/question-groups/:id', async (req, res) => {
  try {
    const { title, description, stimulus } = req.body;
    const result = await query(`
      UPDATE question_groups SET
        title=COALESCE($1,title), description=COALESCE($2,description),
        stimulus=COALESCE($3,stimulus) WHERE id=$4 RETURNING *`,
      [title, description, stimulus, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Kelompok tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui kelompok soal' });
  }
});

router.delete('/question-groups/:id', async (req, res) => {
  try {
    await query('UPDATE questions SET group_id=NULL WHERE group_id=$1', [req.params.id]);
    const result = await query('DELETE FROM question_groups WHERE id=$1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Kelompok tidak ditemukan' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus kelompok soal' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   LIVE CLASSES — FIX: migration tidak punya kolom is_cancelled, updated_at
══════════════════════════════════════════════════════════════════ */

router.get('/live-classes', async (req, res) => {
  try {
    // FIX: hapus JOIN live_registrations (tabel tidak ada di migration)
    const result = await query(`
      SELECT lc.*,
        u.name AS mentor_name,
        p.name AS program_name
      FROM live_classes lc
      LEFT JOIN users u    ON u.id = lc.mentor_id
      LEFT JOIN programs p ON p.id = lc.program_id
      ORDER BY lc.scheduled_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil kelas live' });
  }
});

router.post('/live-classes', async (req, res) => {
  try {
    const { program_id, mentor_id, title, description, category_tag,
            zoom_url, scheduled_at, duration_mins } = req.body;
    const result = await query(`
      INSERT INTO live_classes
        (program_id, mentor_id, title, description, category_tag, zoom_url, scheduled_at, duration_mins)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`,
      [program_id, mentor_id, title, description, category_tag, zoom_url, scheduled_at, duration_mins || 60]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat kelas live' });
  }
});

router.put('/live-classes/:id', async (req, res) => {
  try {
    const { program_id, mentor_id, title, description, category_tag,
            zoom_url, scheduled_at, duration_mins, is_live, recording_url } = req.body;
    // FIX: kolom yang ada di migration: is_live, is_recorded, recording_url (tidak ada is_cancelled/updated_at)
    const result = await query(`
      UPDATE live_classes SET
        program_id    = COALESCE($1,  program_id),
        mentor_id     = COALESCE($2,  mentor_id),
        title         = COALESCE($3,  title),
        description   = COALESCE($4,  description),
        category_tag  = COALESCE($5,  category_tag),
        zoom_url      = COALESCE($6,  zoom_url),
        scheduled_at  = COALESCE($7,  scheduled_at),
        duration_mins = COALESCE($8,  duration_mins),
        is_live       = COALESCE($9,  is_live),
        recording_url = COALESCE($10, recording_url)
      WHERE id = $11
      RETURNING *`,
      [program_id, mentor_id, title, description, category_tag,
       zoom_url, scheduled_at, duration_mins, is_live, recording_url, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui kelas live' });
  }
});

router.delete('/live-classes/:id', async (req, res) => {
  try {
    // FIX: tidak ada kolom is_cancelled di migration → hard delete
    const result = await query(`
      DELETE FROM live_classes WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus kelas live' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   TRANSACTIONS
══════════════════════════════════════════════════════════════════ */

router.get('/transactions', async (req, res) => {
  try {
    const { status, page = 1, limit = 20, from, to } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conditions = [];

    if (status) { params.push(status); conditions.push(`t.status = $${params.length}`); }
    if (from)   { params.push(from);   conditions.push(`t.paid_at >= $${params.length}`); }
    if (to)     { params.push(to);     conditions.push(`t.paid_at <= $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const result = await query(`
      SELECT t.*,
        u.name  AS user_name,
        u.email AS user_email,
        p.name  AS program_name
      FROM transactions t
      LEFT JOIN users u    ON u.id = t.user_id
      LEFT JOIN programs p ON p.id = t.program_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const total = await query(`SELECT COUNT(*) FROM transactions t ${where}`, countParams);
    res.json({ transactions: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil transaksi' });
  }
});

router.get('/transactions/:id', async (req, res) => {
  try {
    const result = await query(`
      SELECT t.*,
        u.name    AS user_name,
        u.email   AS user_email,
        u.phone   AS user_phone,
        p.name    AS program_name,
        p.price   AS program_price
      FROM transactions t
      LEFT JOIN users u    ON u.id = t.user_id
      LEFT JOIN programs p ON p.id = t.program_id
      WHERE t.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil detail transaksi' });
  }
});

router.post('/transactions/:id/refund', async (req, res) => {
  try {
    const trx = await query(`SELECT * FROM transactions WHERE id = $1`, [req.params.id]);
    if (!trx.rows.length) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    if (trx.rows[0].status !== 'success') {
      return res.status(400).json({ error: 'Hanya transaksi sukses yang bisa direfund' });
    }

    // FIX: status 'refunded' → tidak ada di CHECK constraint migration, pakai 'refund'
    const result = await query(`
      UPDATE transactions SET status = 'refund', updated_at = NOW()
      WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    await query(`
      UPDATE user_programs SET is_active = false
      WHERE user_id = $1 AND program_id = $2`,
      [trx.rows[0].user_id, trx.rows[0].program_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memproses refund' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   MATERI — FIX: migration pakai modules/lessons, bukan materi_topics/materi_videos
   Endpoint tetap sama agar frontend tidak perlu diubah
══════════════════════════════════════════════════════════════════ */

router.get('/materi/topics', async (req, res) => {
  try {
    const { program } = req.query;
    const params = [];
    let where = '';
    if (program) { params.push(program); where = `WHERE m.program_id = $1`; }

    // FIX: pakai modules, bukan materi_topics
    const result = await query(`
      SELECT m.id, m.program_id, m.title, m.icon, m.order_index as order_num,
             m.created_at, p.name AS program_name,
             COUNT(l.id) AS video_count
      FROM modules m
      LEFT JOIN programs p ON p.id = m.program_id
      LEFT JOIN lessons  l ON l.module_id = m.id
      ${where}
      GROUP BY m.id, p.name
      ORDER BY m.order_index ASC, m.created_at ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil topik materi' });
  }
});

router.post('/materi/topics', async (req, res) => {
  try {
    const { program_id, title, icon, order_num } = req.body;
    // FIX: INSERT ke modules
    const result = await query(`
      INSERT INTO modules (program_id, title, icon, order_index)
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [program_id, title, icon || '📖', order_num || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal membuat topik materi' });
  }
});

router.put('/materi/topics/:id', async (req, res) => {
  try {
    const { title, icon, order_num } = req.body;
    // FIX: UPDATE modules (tidak ada is_free/is_active di migration modules)
    const result = await query(`
      UPDATE modules SET
        title       = COALESCE($1, title),
        icon        = COALESCE($2, icon),
        order_index = COALESCE($3, order_index)
      WHERE id = $4
      RETURNING *`,
      [title, icon, order_num, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Topik tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui topik materi' });
  }
});

router.delete('/materi/topics/:id', async (req, res) => {
  try {
    // FIX: hapus lessons dulu (CASCADE sudah ada, tapi eksplisit lebih aman)
    await query(`DELETE FROM lessons WHERE module_id = $1`, [req.params.id]);
    const result = await query(`DELETE FROM modules WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Topik tidak ditemukan' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus topik materi' });
  }
});

router.get('/materi/topics/:id/videos', async (req, res) => {
  try {
    // FIX: pakai lessons, bukan materi_videos
    const result = await query(`
      SELECT id, module_id as topic_id, title, video_url, pdf_url,
             duration_mins, order_index as order_num, type,
             is_free_preview as is_free, description, created_at
      FROM lessons
      WHERE module_id = $1
      ORDER BY order_index ASC, created_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil video' });
  }
});

router.post('/materi/topics/:id/videos', async (req, res) => {
  try {
    const { title, video_url, pdf_url, description, duration_mins, order_num, is_free = false, type = 'video' } = req.body;
    // FIX: INSERT ke lessons
    // Ambil program_id dari module dulu
    const mod = await query(`SELECT program_id FROM modules WHERE id = $1`, [req.params.id]);
    if (!mod.rows.length) return res.status(404).json({ error: 'Topik tidak ditemukan' });

    const result = await query(`
      INSERT INTO lessons
        (module_id, program_id, title, type, video_url, pdf_url, description, duration_mins, order_index, is_free_preview)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [req.params.id, mod.rows[0].program_id, title, type,
       video_url, pdf_url, description, duration_mins || 0, order_num || 0, is_free]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambah video' });
  }
});

router.put('/materi/videos/:id', async (req, res) => {
  try {
    const { title, video_url, pdf_url, description, duration_mins, type, is_free, order_num } = req.body;
    const result = await query(`
      UPDATE lessons SET
        title            = COALESCE($1, title),
        video_url        = COALESCE($2, video_url),
        pdf_url          = COALESCE($3, pdf_url),
        description      = COALESCE($4, description),
        duration_mins    = COALESCE($5, duration_mins),
        type             = COALESCE($6, type),
        is_free_preview  = COALESCE($7, is_free_preview),
        order_index      = COALESCE($8, order_index)
      WHERE id = $9
      RETURNING id, module_id as topic_id, title, video_url, pdf_url,
                duration_mins, order_index as order_num, type,
                is_free_preview as is_free, description, created_at`,
      [title, video_url, pdf_url, description, duration_mins, type,
       is_free, order_num, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Video tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui video' });
  }
});

router.delete('/materi/videos/:id', async (req, res) => {
  try {
    // FIX: DELETE dari lessons
    const result = await query(`DELETE FROM lessons WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Video tidak ditemukan' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus video' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   LANDING PAGE BUILDER
══════════════════════════════════════════════════════════════════ */

// Banners
router.get('/landing/banners', async (req, res) => {
  try {
    const r = await query('SELECT * FROM landing_banners ORDER BY order_index ASC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/landing/banners', audit('create_banner', 'banner'), async (req, res) => {
  try {
    const { image_url, title, subtitle, cta_text, cta_link, badge_text, order_index } = req.body;
    const r = await query(
      `INSERT INTO landing_banners (image_url, title, subtitle, cta_text, cta_link, badge_text, order_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [image_url || null, title, subtitle || null, cta_text || null, cta_link || null, badge_text || null, order_index || 0]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/landing/banners/:id', audit('update_banner', 'banner'), async (req, res) => {
  try {
    const { image_url, title, subtitle, cta_text, cta_link, badge_text, order_index, is_active } = req.body;
    const r = await query(
      `UPDATE landing_banners SET image_url=$1, title=$2, subtitle=$3, cta_text=$4, cta_link=$5, badge_text=$6, order_index=$7, is_active=$8 WHERE id=$9 RETURNING *`,
      [image_url || null, title, subtitle || null, cta_text || null, cta_link || null, badge_text || null, order_index || 0, is_active ?? true, req.params.id]
    );
    res.json(r.rows[0] || { error: 'not found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/landing/banners/:id', async (req, res) => {
  try {
    await query('DELETE FROM landing_banners WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Promotions
router.get('/landing/promotions', async (req, res) => {
  try {
    const r = await query('SELECT * FROM landing_promotions ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/landing/promotions', async (req, res) => {
  try {
    const { title, description, discount_text, coupon_code, image_url, bg_color, is_active, show_on_pages, starts_at, ends_at } = req.body;
    const r = await query(
      `INSERT INTO landing_promotions (title, description, discount_text, coupon_code, image_url, bg_color, is_active, show_on_pages, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [title, description || null, discount_text || null, coupon_code || null, image_url || null, bg_color || '#FF6B00', is_active ?? true, show_on_pages || 'landing', starts_at || new Date(), ends_at || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/landing/promotions/:id', async (req, res) => {
  try {
    const { title, description, discount_text, coupon_code, image_url, bg_color, is_active, show_on_pages, starts_at, ends_at } = req.body;
    const r = await query(
      `UPDATE landing_promotions SET title=$1, description=$2, discount_text=$3, coupon_code=$4, image_url=$5, bg_color=$6, is_active=$7, show_on_pages=$8, starts_at=$9, ends_at=$10 WHERE id=$11 RETURNING *`,
      [title, description || null, discount_text || null, coupon_code || null, image_url || null, bg_color || '#FF6B00', is_active ?? true, show_on_pages || 'landing', starts_at || new Date(), ends_at || null, req.params.id]
    );
    res.json(r.rows[0] || { error: 'not found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/landing/promotions/:id', async (req, res) => {
  try {
    await query('DELETE FROM landing_promotions WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sections
router.get('/landing/sections', async (req, res) => {
  try {
    const r = await query('SELECT * FROM landing_sections ORDER BY section_key');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/landing/sections/:key', async (req, res) => {
  try {
    const { title, subtitle, content, is_active } = req.body;
    const r = await query(
      `UPDATE landing_sections SET title=$1, subtitle=$2, content=$3, is_active=$4 WHERE section_key=$5 RETURNING *`,
      [title, subtitle || null, JSON.stringify(content || {}), is_active ?? true, req.params.key]
    );
    res.json(r.rows[0] || { error: 'not found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Settings (admin_settings table)
router.get('/landing/settings', async (req, res) => {
  try {
    const r = await query('SELECT * FROM admin_settings ORDER BY key');
    const map = {};
    r.rows.forEach(row => { map[row.key] = row.value; });
    res.json(map);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/landing/settings/:key', audit('update_setting', 'setting'), async (req, res) => {
  try {
    const { value } = req.body;
    const r = await query(
      `INSERT INTO admin_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()
       RETURNING *`,
      [req.params.key, JSON.stringify(value)]
    );
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ══════════════════════════════════════════════════════════════════
   NOTIFICATIONS
══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   COUPONS
══════════════════════════════════════════════════════════════════ */

router.get('/coupons', async (req, res) => {
  try {
    const r = await query('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/coupons', async (req, res) => {
  try {
    const { code, type, value, min_purchase, max_uses, program_id, expires_at } = req.body;
    const r = await query(
      `INSERT INTO coupons (code, type, value, min_purchase, max_uses, program_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [code.toUpperCase(), type || 'percent', value, min_purchase || 0, max_uses || 0, program_id || null, expires_at || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Kode kupon sudah digunakan' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/coupons/:id', async (req, res) => {
  try {
    const { type, value, min_purchase, max_uses, is_active, expires_at } = req.body;
    const r = await query(
      `UPDATE coupons SET type=$1, value=$2, min_purchase=$3, max_uses=$4, is_active=$5, expires_at=$6 WHERE id=$7 RETURNING *`,
      [type, value, min_purchase, max_uses, is_active, expires_at, req.params.id]
    );
    res.json(r.rows[0] || { error: 'not found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/coupons/:id', async (req, res) => {
  try {
    await query('DELETE FROM coupons WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/notifications/broadcast', async (req, res) => {
  try {
    const { title, message, type, target } = req.body;
    let userIds;

    if (target === 'all') {
      const users = await query("SELECT id FROM users WHERE role='user' AND is_active=true");
      userIds = users.rows.map(r => r.id);
    } else if (target === 'premium') {
      const users = await query("SELECT id FROM users WHERE plan IN ('premium','vip') AND is_active=true");
      userIds = users.rows.map(r => r.id);
    } else if (Array.isArray(target)) {
      userIds = target;
    } else {
      return res.status(400).json({ error: 'Target tidak valid' });
    }

    if (userIds.length) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map((_, j) =>
          `($${j * 4 + 1}, $${j * 4 + 2}, $${j * 4 + 3}, $${j * 4 + 4})`
        ).join(',');
        const values = batch.flatMap(uid => [uid, title, message, type || 'info']);
        await query(
          `INSERT INTO notifications (user_id, title, message, type) VALUES ${placeholders}`,
          values
        );
      }
    }

    res.json({ sent: userIds.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengirim notifikasi' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   AUDIT LOGS
══════════════════════════════════════════════════════════════════ */

router.get('/audit-logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, action, entity_type, admin_id } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    const conds = [];

    if (action)      { params.push(action);      conds.push(`action=$${params.length}`); }
    if (entity_type) { params.push(entity_type); conds.push(`entity_type=$${params.length}`); }
    if (admin_id)    { params.push(admin_id);    conds.push(`admin_id=$${params.length}`); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const count = await query(`SELECT COUNT(*) FROM audit_logs ${where}`, params);
    const rows = await query(
      `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ logs: rows.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil audit log' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   MENTORS (admin management)
══════════════════════════════════════════════════════════════════ */

router.get('/mentors', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.name, u.email, u.avatar_url, u.photo_url, u.city, u.bio, u.reward_points,
             u.is_active, u.created_at, u.specialization, u.schedule,
             (SELECT COUNT(*) FROM live_classes lc WHERE lc.mentor_id=u.id) as total_classes,
             (SELECT COUNT(*) FROM mentoring_sessions ms WHERE ms.mentor_id=u.id) as total_sessions
      FROM users u WHERE u.role='mentor' ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil daftar mentor' });
  }
});

router.put('/mentors/:id', audit('update_mentor', 'mentor'), async (req, res) => {
  try {
    const { name, city, bio, is_active, specialization, photo_url, schedule } = req.body;
    const result = await query(
      `UPDATE users SET name=COALESCE($1,name), city=COALESCE($2,city), bio=COALESCE($3,bio),
       is_active=COALESCE($4,is_active),
       specialization=COALESCE($5::text[],specialization),
       photo_url=COALESCE($6,photo_url),
       schedule=COALESCE($7::jsonb,schedule),
       updated_at=NOW()
       WHERE id=$8 AND role='mentor' RETURNING id,name,email,role,is_active`,
      [name, city, bio, is_active, specialization || null, photo_url || null, schedule ? JSON.stringify(schedule) : null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Mentor tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengupdate mentor' });
  }
});

router.put('/users/:id/role', audit('change_role', 'user'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'mentor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role tidak valid' });
    }
    if (req.user.id === req.params.id) {
      return res.status(400).json({ error: 'Tidak bisa mengubah role sendiri' });
    }
    const result = await query(
      `UPDATE users SET role=$1, updated_at=NOW() WHERE id=$2 RETURNING id,name,email,role,is_active`,
      [role, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengubah role user' });
  }
});

/* ── Database Backup ── */

function buildPgDumpCmd() {
  const pgDumpBin = fs.existsSync('/usr/lib/postgresql/18/bin/pg_dump')
    ? '/usr/lib/postgresql/18/bin/pg_dump' : 'pg_dump';
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) return `${pgDumpBin} "${dbUrl}" --no-owner --no-acl --clean --if-exists`;
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const db = process.env.DB_NAME || 'kuarta_db';
  const user = process.env.DB_USER || 'postgres';
  return `${pgDumpBin} --no-owner --no-acl --clean --if-exists -h ${host} -p ${port} -U ${user} -d ${db}`;
}

router.get('/backup', async (req, res) => {
  try {
    const cmd = buildPgDumpCmd();
    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || '' };
    exec(cmd, { env, maxBuffer: 50 * 1024 * 1024, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('pg_dump error:', err.message, stderr);
        const msg = stderr?.trim() || err.message || 'Gagal backup database';
        return res.status(500).json({ error: msg });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      res.setHeader('Content-Type', 'application/sql');
      res.setHeader('Content-Disposition', `attachment; filename="kuarta_backup_${timestamp}.sql"`);
      res.send(stdout);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal backup database' });
  }
});

/* ── Download .docx Template ── */

router.get('/questions/template/docx', async (req, res) => {
  try {
    const example = [
      {
        no: 1, question: 'Bentuk sederhana dari (2³ × 2⁴) / 2⁵ adalah...',
        a: '2', b: '4', c: '8', d: '16', e: '32',
        answer: 'B', category: 'TIU', explanation: '2³ × 2⁴ = 2⁷, dibagi 2⁵ = 2² = 4',
      },
      {
        no: 2, question: 'Pancasila sebagai dasar negara tercantum dalam...',
        a: 'Piagam Jakarta', b: 'Pembukaan UUD 1945', c: 'Pasal 1 UUD 1945',
        d: 'Ketetapan MPR', e: 'Dekrit Presiden',
        answer: 'B', category: 'TWK',
        explanation: 'Pancasila secara resmi tercantum dalam Pembukaan UUD 1945 alinea ke-4',
      },
    ];

    const rows = [
      new TableRow({
        tableHeader: true,
        children: ['No','Soal','A','B','C','D','E','Jawaban','Kategori','Pembahasan'].map(h =>
          new TableCell({
            width: { size: h === 'Pembahasan' ? 30 : h === 'Soal' ? 25 : 10, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: h, bold: true, size: 18, font: 'Calibri' })]
            })],
            shading: { fill: 'E8E8E8' },
          })
        ),
      }),
      ...example.map(e =>
        new TableRow({
          children: [e.no, e.question, e.a, e.b, e.c, e.d, e.e, e.answer, e.category, e.explanation].map((v, ci) =>
            new TableCell({
              width: { size: ci === 9 ? 30 : ci === 1 ? 25 : 10, type: WidthType.PERCENTAGE },
              children: [new Paragraph({
                spacing: { before: 40, after: 40 },
                children: [new TextRun({ text: String(v), size: 18, font: 'Calibri' })]
              })]
            })
          ),
        })
      ),
    ];

    const doc = new Document({
      creator: 'Kuarta Bimbel',
      title: 'Template Bank Soal',
      styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
      sections: [{
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [new TextRun({ text: 'TEMPLATE BANK SOAL KUARTA', bold: true, size: 28, font: 'Calibri' })],
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [new TextRun({ text: 'Isi sesuai format di bawah. Baris "Soal 1:", "Jawaban:", "Kategori:", "Pembahasan:" bersifat opsional tapi dianjurkan.', size: 20, font: 'Calibri', color: '666666' })],
          }),
          new Paragraph({
            spacing: { after: 400 },
            children: [new TextRun({ text: 'Format alternatif — tulis langsung seperti contoh:', size: 20, font: 'Calibri', bold: true }),
                       new TextRun({ text: '\nSoal 1:\nTeks soal...\nA. Opsi A\nB. Opsi B\nC. Opsi C\nD. Opsi D\nE. Opsi E\nJawaban: A\nKategori: TIU\nPembahasan: Penjelasan...', size: 20, font: 'Consolas', color: '333333' })],
          }),
          new Paragraph({
            spacing: { before: 200, after: 100 },
            children: [new TextRun({ text: 'Contoh data (tabel):', bold: true, size: 22, font: 'Calibri' })],
          }),
          new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
          new Paragraph({
            spacing: { before: 400 },
            children: [new TextRun({ text: 'Kategori yang tersedia: ', bold: true, size: 20, font: 'Calibri' }),
                       new TextRun({ text: 'TWK, TIU, TKP, PU, PM, LBI, LBE, PBM', size: 20, font: 'Calibri' })],
          }),
          new Paragraph({
            spacing: { before: 100 },
            children: [new TextRun({ text: 'Jawaban: ', bold: true, size: 20, font: 'Calibri' }),
                       new TextRun({ text: 'A / B / C / D / E', size: 20, font: 'Calibri' })],
          }),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="template_bank_soal_kuarta.docx"');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal generate template' });
  }
});

export default router;