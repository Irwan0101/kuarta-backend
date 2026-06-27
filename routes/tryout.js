import { Router } from 'express';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

// GET /api/tryout
router.get('/', authenticate, async (req, res) => {
  try {
    const { program_id } = req.query;
    let sql = `
      SELECT tp.*,
        CASE WHEN tr.user_id IS NOT NULL THEN true ELSE false END as is_done,
        tr.total_score as my_score, tr.passed as my_passed,
        tr.id as my_result_id
      FROM tryout_packages tp
      LEFT JOIN LATERAL (
        SELECT user_id, total_score, passed, id
        FROM tryout_results
        WHERE user_id=$1 AND tryout_id=tp.id
        ORDER BY created_at DESC LIMIT 1
      ) tr ON true
      WHERE tp.is_active=true
    `;
    const params = [req.user.id];
    if (program_id) { params.push(program_id); sql += ` AND tp.program_id=$2`; }
    sql += ' ORDER BY tp.type DESC, tp.created_at';

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil paket tryout' });
  }
});

// GET /api/tryout/:id/questions  — get questions (shuffled)
router.get('/:id/questions', authenticate, async (req, res) => {
  try {
    // Check enrollment
    const toRes = await query(
      'SELECT tp.*, p.id as prog_id FROM tryout_packages tp JOIN programs p ON p.id=tp.program_id WHERE tp.id=$1',
      [req.params.id]
    );
    if (!toRes.rows.length) return res.status(404).json({ error: 'Tryout tidak ditemukan' });

    const to = toRes.rows[0];
    const enrolled = await query(
      'SELECT id FROM user_programs WHERE user_id=$1 AND program_id=$2 AND is_active=true',
      [req.user.id, to.prog_id]
    );
    if (!enrolled.rows.length) {
      return res.status(403).json({ error: 'Kamu belum terdaftar di program ini' });
    }

    const result = await query(`
      SELECT q.id, q.category, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.option_e, q.order_index, q.score_value
      FROM questions q
      LEFT JOIN tryout_questions tq ON tq.question_id = q.id
      WHERE q.tryout_id=$1 OR tq.tryout_id=$1
      ORDER BY COALESCE(tq.order_index, q.order_index)`,
      [req.params.id]
    );

    res.json({
      tryout: {
        id: to.id, title: to.title, type: to.type,
        question_count: to.question_count, duration_mins: to.duration_mins,
        passing_score: to.passing_score,
      },
      questions: result.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil soal' });
  }
});

// POST /api/tryout/:id/submit
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    const { answers, duration_secs } = req.body;
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Jawaban tidak valid' });
    }

    const toRes = await query('SELECT * FROM tryout_packages WHERE id=$1', [req.params.id]);
    if (!toRes.rows.length) return res.status(404).json({ error: 'Tryout tidak ditemukan' });
    const to = toRes.rows[0];

    const questRes = await query(`
      SELECT q.id, q.category, q.correct_answer, q.score_value
      FROM questions q
      LEFT JOIN tryout_questions tq ON tq.question_id = q.id
      WHERE q.tryout_id=$1 OR tq.tryout_id=$1`,
      [req.params.id]
    );
    const questions = questRes.rows;

    // Score calculation
    let twk = 0, tiu = 0, tkp = 0;
    let correct = 0, wrong = 0, empty = 0;
    const detailedAnswers = {};

    for (const q of questions) {
      const userAnswer = answers[q.id];
      if (!userAnswer) { empty++; detailedAnswers[q.id] = { answer: null, correct: q.correct_answer, is_correct: false }; continue; }

      const isCorrect = userAnswer.toUpperCase() === q.correct_answer.toUpperCase();
      detailedAnswers[q.id] = { answer: userAnswer, correct: q.correct_answer, is_correct: isCorrect };

      if (isCorrect) {
        correct++;
        if (q.category === 'TWK') twk += q.score_value;
        else if (q.category === 'TIU') tiu += q.score_value;
        else tkp += q.score_value;
      } else {
        wrong++;
      }
    }

    const total = twk + tiu + tkp;
    const passed = total >= (to.passing_score || 311);

    const resultRes = await query(`
      INSERT INTO tryout_results (user_id, tryout_id, twk_score, tiu_score, tkp_score,
                                  total_score, correct_count, wrong_count, empty_count,
                                  duration_secs, passed, answers, finished_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW()) RETURNING *`,
      [req.user.id, req.params.id, twk, tiu, tkp, total,
       correct, wrong, empty, duration_secs || 0, passed, JSON.stringify(detailedAnswers)]
    );

    // Award points
    const points = passed ? 100 : 30;
    await query('UPDATE users SET reward_points=reward_points+$1 WHERE id=$2', [points, req.user.id]);

    // Update participant count
    await query('UPDATE tryout_packages SET participant_count=participant_count+1 WHERE id=$1', [req.params.id]);

    res.json({ result: resultRes.rows[0], answers: detailedAnswers });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Gagal menyimpan hasil tryout' });
  }
});

// GET /api/tryout/results/history
router.get('/results/history', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT tr.*, tp.title as tryout_title, tp.type as tryout_type, p.name as program_name
      FROM tryout_results tr
      JOIN tryout_packages tp ON tp.id=tr.tryout_id
      JOIN programs p ON p.id=tp.program_id
      WHERE tr.user_id=$1
      ORDER BY tr.created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil riwayat tryout' });
  }
});

// GET /api/tryout/results/by-tryout/:tryoutId
router.get('/results/by-tryout/:tryoutId', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT tr.*, tp.title as tryout_title, tp.passing_score,
             tp.duration_mins, p.name as program_name
      FROM tryout_results tr
      JOIN tryout_packages tp ON tp.id=tr.tryout_id
      JOIN programs p ON p.id=tp.program_id
      WHERE tr.user_id=$1 AND tr.tryout_id=$2
      ORDER BY tr.created_at DESC LIMIT 1`,
      [req.user.id, req.params.tryoutId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Hasil tryout tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil hasil tryout' });
  }
});

// GET /api/tryout/leaderboard
router.get('/leaderboard/global', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.name, u.city, u.avatar_url,
             p.name as program_name, MAX(tr.total_score) as best_score,
             RANK() OVER (ORDER BY MAX(tr.total_score) DESC) as rank
      FROM tryout_results tr
      JOIN users u ON u.id=tr.user_id
      JOIN tryout_packages tp ON tp.id=tr.tryout_id
      JOIN programs p ON p.id=tp.program_id
      GROUP BY u.id, u.name, u.city, u.avatar_url, p.name
      ORDER BY best_score DESC
      LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil leaderboard' });
  }
});

// POST /api/tryout/questions (admin)
router.post('/questions', authenticate, requireAdmin, async (req, res) => {
  try {
    const { tryout_id, category, question_text, option_a, option_b, option_c, option_d,
            option_e, correct_answer, explanation, difficulty, score_value } = req.body;

    const result = await query(`
      INSERT INTO questions (tryout_id, category, question_text, option_a, option_b, option_c,
                             option_d, option_e, correct_answer, explanation, difficulty, score_value)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [tryout_id, category, question_text, option_a, option_b, option_c, option_d,
       option_e || null, correct_answer.toUpperCase(), explanation, difficulty || 'medium', score_value || 5]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambah soal' });
  }
});

export default router;