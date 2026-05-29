import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import crypto from 'crypto'; // tambah di bagian atas


import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BrevoClient } = require('@getbrevo/brevo');

const sendOtpEmail = async (name, email, otp) => {
  const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

  await client.transactionalEmails.sendTransacEmail({
    sender: { name: 'Kuarta Bimbel', email: process.env.SMTP_FROM },
    to: [{ email }],
    subject: 'Kode OTP Reset Password Kuarta',
    htmlContent: `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#0F0F0F;font-family:'Segoe UI',sans-serif;">

      <!-- Wrapper -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F0F0F;padding:40px 16px;">
        <tr><td align="center">
          <table width="100%" style="max-width:480px;">

            <!-- Header / Logo -->
            <tr><td align="center" style="padding-bottom:28px;">
              <div style="
                width:56px;height:56px;border-radius:16px;
                background:linear-gradient(135deg,#F97316,#ea6a0a);
                display:inline-flex;align-items:center;justify-content:center;
                box-shadow:0 8px 32px rgba(249,115,22,0.4);
                font-size:26px;font-weight:900;color:#fff;
                font-family:'Segoe UI',sans-serif;
                text-align:center;line-height:56px;
              ">K</div>
              <div style="margin-top:12px;font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">
                Kuarta Bimbel
              </div>
              <div style="font-size:13px;color:#888;margin-top:4px;">
                Platform Belajar CPNS & Kedinasan
              </div>
            </td></tr>

            <!-- Card -->
            <tr><td style="
              background:#1A1A1A;border:1px solid #2A2A2A;
              border-radius:20px;padding:32px 32px 28px;
            ">
              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#FFFFFF;">
                Halo, ${name}! 👋
              </p>
              <p style="margin:0 0 24px;font-size:13px;color:#888;line-height:1.7;">
                Kami menerima permintaan reset password untuk akunmu. Gunakan kode OTP berikut untuk melanjutkan.
              </p>

              <!-- OTP Box -->
              <div style="
                background:#111111;border:1px solid #2A2A2A;
                border-radius:14px;padding:24px;
                text-align:center;margin-bottom:24px;
              ">
                <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.1em;margin-bottom:12px;text-transform:uppercase;">
                  Kode OTP Kamu
                </div>
                <div style="
                  font-size:42px;font-weight:900;letter-spacing:0.35em;
                  color:#F97316;font-family:monospace;
                  text-shadow:0 0 32px rgba(249,115,22,0.4);
                ">
                  ${otp}
                </div>
                <div style="
                  margin-top:14px;display:inline-block;
                  background:rgba(249,115,22,0.1);border:1px solid rgba(249,115,22,0.2);
                  border-radius:20px;padding:4px 14px;
                  font-size:11px;color:#F97316;font-weight:600;
                ">
                  ⏱ Berlaku 10 menit
                </div>
              </div>

              <!-- Divider -->
              <div style="border-top:1px solid #2A2A2A;margin-bottom:20px;"></div>

              <!-- Warning -->
              <div style="
                background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.15);
                border-radius:10px;padding:12px 14px;margin-bottom:20px;
                display:flex;gap:10px;align-items:flex-start;
              ">
                <span style="font-size:14px;">⚠️</span>
                <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">
                  Jangan bagikan kode ini kepada siapapun, termasuk tim Kuarta. Jika kamu tidak merasa meminta reset password, abaikan email ini.
                </p>
              </div>

              <!-- Footer note -->
              <p style="margin:0;font-size:11px;color:#555;text-align:center;line-height:1.7;">
                Email ini dikirim otomatis oleh sistem Kuarta Bimbel.<br>
                Butuh bantuan? Hubungi kami di <a href="mailto:${process.env.SMTP_FROM}" style="color:#F97316;text-decoration:none;">${process.env.SMTP_FROM}</a>
              </p>
            </td></tr>

            <!-- Bottom -->
            <tr><td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:11px;color:#444;">
                © ${new Date().getFullYear()} Kuarta Bimbel · All rights reserved
              </p>
            </td></tr>

          </table>
        </td></tr>
      </table>

    </body>
    </html>
    `,
  });
};
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


// ─────────────────────────────────────────────
// POST /api/auth/forgot-password
// Generate OTP & kirim ke email
// ─────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email wajib diisi' });

    const result = await query(
      'SELECT id, name FROM users WHERE email=$1 AND is_active=true',
      [email.toLowerCase().trim()]
    );

    // Selalu respons sukses agar tidak bisa dipakai enumerasi user
    if (!result.rows.length) {
      return res.json({ message: 'Jika email terdaftar, kode OTP telah dikirim.' });
    }

    const user = result.rows[0];

    // Buat OTP 6 digit
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 menit

    // Hapus OTP lama, simpan yang baru
    await query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user.id]);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, otp, expiresAt]
    );

    await sendOtpEmail(user.name, email.toLowerCase().trim(), otp);

    res.json({ message: 'Jika email terdaftar, kode OTP telah dikirim.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Gagal memproses permintaan reset password' });
  }
});


// ─────────────────────────────────────────────
// POST /api/auth/verify-otp
// Verifikasi OTP, kembalikan temp token untuk reset
// ─────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email dan OTP wajib diisi' });
    }

    const result = await query(
      `SELECT prt.user_id
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE u.email=$1
         AND prt.token=$2
         AND prt.expires_at > NOW()
         AND u.is_active=true`,
      [email.toLowerCase().trim(), otp]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: 'Kode OTP salah atau sudah kedaluwarsa' });
    }

    const { user_id } = result.rows[0];

    // Buat reset token sementara (berlaku 15 menit) untuk step berikutnya
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 15 * 60 * 1000);

    await query(
      `UPDATE password_reset_tokens
       SET token=$1, expires_at=$2
       WHERE user_id=$3`,
      [resetToken, resetExpiry, user_id]
    );

    res.json({ resetToken });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Gagal memverifikasi OTP' });
  }
});


// ─────────────────────────────────────────────
// POST /api/auth/reset-password
// Simpan password baru menggunakan resetToken
// ─────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Token dan password baru wajib diisi' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password minimal 8 karakter' });
    }

    const result = await query(
      `SELECT prt.user_id FROM password_reset_tokens prt
       WHERE prt.token=$1 AND prt.expires_at > NOW()`,
      [resetToken]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: 'Sesi reset tidak valid atau sudah kedaluwarsa' });
    }

    const { user_id } = result.rows[0];
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [passwordHash, user_id]);
    await query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user_id]);

    await query(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES ($1, $2, $3, 'info')`,
      [user_id, 'Password Diubah', 'Password akunmu baru saja berhasil diubah. Jika bukan kamu, segera hubungi kami.']
    );

    res.json({ message: 'Password berhasil direset. Silakan login.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Gagal mereset password' });
  }
});
export default router;