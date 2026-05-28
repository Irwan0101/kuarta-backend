import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const genTokens = (userId) => ({
  accessToken: jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }),
  refreshToken: jwt.sign({ userId, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '30d' }),
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, city } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nama, email, dan password wajib diisi' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password minimal 8 karakter' });
    }

    const existing = await query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email sudah terdaftar' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, phone, city, email_verified)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id, name, email, role, plan, avatar_url, reward_points, streak_count`,
      [name.trim(), email.toLowerCase(), passwordHash, phone || null, city || null]
    );

    const user = result.rows[0];
    const tokens = genTokens(user.id);

    // Welcome notification
    await query(
      `INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,'success')`,
      [user.id, 'Selamat Bergabung! 🎉', `Halo ${user.name}! Mulailah perjalanan belajarmu di Kuarta.`]
    );

    res.status(201).json({ user, ...tokens });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registrasi gagal' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan password wajib diisi' });
    }

    // 1. Cari user berdasarkan email
    const result = await query(
      'SELECT * FROM users WHERE email=$1 AND is_active=true',
      [email.toLowerCase().trim()] // Tambah .trim() untuk menghindari spasi tak sengaja
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }

    const user = result.rows[0];

    // 2. Validasi password brypt
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }

    // 3. LOGIKA STREAK (DIPERBAIKI)
    // Ambil tanggal hari ini (YYYY-MM-DD) berdasarkan waktu lokal/WIB agar sinkron dengan database
    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    
    // Ambil tanggal kemarin (YYYY-MM-DD)
    const yesterdayObj = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterday = yesterdayObj.toISOString().split('T')[0];

    // Ambil tanggal terakhir login dari DB (Pastikan dikonversi ke Date dulu agar aman)
    let lastDate = null;
    if (user.streak_last_date) {
      const dbDate = new Date(user.streak_last_date);
      lastDate = new Date(dbDate.getTime() - dbDate.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    }

    let newStreak = user.streak_count || 0;
    if (lastDate === yesterday) {
      newStreak += 1; // Melanjutkan streak
    } else if (lastDate !== today) {
      newStreak = 1;  // Streak hangus, mulai dari 1 lagi
    } // Jika lastDate === today, streak tetap (tidak bertambah/berkurang)

    // Update streak ke database
    await query(
      'UPDATE users SET streak_count=$1, streak_last_date=$2 WHERE id=$3',
      [newStreak, today, user.id]
    );

    // 4. GENERATE TOKEN & RESPONSE (DISESUAIKAN DENGAN FRONTEND)
    const tokens = genTokens(user.id); // Asumsi menghasilkan { accessToken: '...', refreshToken: '...' }
    
    const { password_hash, ...safeUser } = user;
    safeUser.streak_count = newStreak;
    safeUser.streak_last_date = today;

    // 🌟 KUNCI PERBAIKAN: Kirim 'token' agar terbaca oleh Zustand (data.token) di frontend kamu
    res.json({ 
      user: safeUser, 
      token: tokens.token || tokens.accessToken, // Mengantisipasi jika genTokens mengembalikan key 'accessToken'
      refreshToken: tokens.refreshToken 
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat login' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token diperlukan' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (decoded.type !== 'refresh') return res.status(401).json({ error: 'Token tidak valid' });

    const result = await query('SELECT id FROM users WHERE id=$1 AND is_active=true', [decoded.userId]);
    if (!result.rows.length) return res.status(401).json({ error: 'User tidak ditemukan' });

    res.json(genTokens(decoded.userId));
  } catch (err) {
    res.status(401).json({ error: 'Refresh token tidak valid atau kedaluwarsa' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.phone, u.city, u.bio, u.role, u.plan,
              u.plan_expires_at, u.avatar_url, u.reward_points, u.streak_count,
              u.streak_last_date, u.target_exam, u.created_at,
              COUNT(DISTINCT up.program_id) FILTER (WHERE up.is_active) as active_programs,
              COALESCE(MAX(tr.total_score),0) as best_score
       FROM users u
       LEFT JOIN user_programs up ON up.user_id=u.id
       LEFT JOIN tryout_results tr ON tr.user_id=u.id
       WHERE u.id=$1
       GROUP BY u.id`,
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data user' });
  }
});

// PUT /api/auth/profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name, phone, city, bio, target_exam } = req.body;
    const result = await query(
      `UPDATE users SET name=COALESCE($1,name), phone=COALESCE($2,phone),
       city=COALESCE($3,city), bio=COALESCE($4,bio), target_exam=COALESCE($5,target_exam)
       WHERE id=$6 RETURNING id,name,email,phone,city,bio,target_exam,role,plan`,
      [name, phone, city, bio, target_exam, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui profil' });
  }
});

// PUT /api/auth/password
router.put('/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password baru minimal 8 karakter' });
    }

    const result = await query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Password lama salah' });

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Password berhasil diubah' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengubah password' });
  }
});

export default router;