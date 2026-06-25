import dotenv from 'dotenv';
dotenv.config();
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';

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
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F0F0F;padding:40px 16px;">
        <tr><td align="center">
          <table width="100%" style="max-width:480px;">
            <tr><td align="center" style="padding-bottom:28px;">
              <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#F97316,#ea6a0a);display:inline-flex;align-items:center;justify-content:center;box-shadow:0 8px 32px rgba(249,115,22,0.4);font-size:26px;font-weight:900;color:#fff;font-family:'Segoe UI',sans-serif;text-align:center;line-height:56px;">K</div>
              <div style="margin-top:12px;font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">Kuarta Bimbel</div>
              <div style="font-size:13px;color:#888;margin-top:4px;">Platform Belajar CPNS & Kedinasan</div>
            </td></tr>
            <tr><td style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:20px;padding:32px 32px 28px;">
              <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#FFFFFF;">Halo, ${name}! 👋</p>
              <p style="margin:0 0 24px;font-size:13px;color:#888;line-height:1.7;">Kami menerima permintaan reset password untuk akunmu. Gunakan kode OTP berikut untuk melanjutkan.</p>
              <div style="background:#111111;border:1px solid #2A2A2A;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px;">
                <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.1em;margin-bottom:12px;text-transform:uppercase;">Kode OTP Kamu</div>
                <div style="font-size:42px;font-weight:900;letter-spacing:0.35em;color:#F97316;font-family:monospace;text-shadow:0 0 32px rgba(249,115,22,0.4);">${otp}</div>
                <div style="margin-top:14px;display:inline-block;background:rgba(249,115,22,0.1);border:1px solid rgba(249,115,22,0.2);border-radius:20px;padding:4px 14px;font-size:11px;color:#F97316;font-weight:600;">⏱ Berlaku 10 menit</div>
              </div>
              <div style="border-top:1px solid #2A2A2A;margin-bottom:20px;"></div>
              <div style="background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.15);border-radius:10px;padding:12px 14px;margin-bottom:20px;display:flex;gap:10px;align-items:flex-start;">
                <span style="font-size:14px;">⚠️</span>
                <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">Jangan bagikan kode ini kepada siapapun, termasuk tim Kuarta. Jika kamu tidak merasa meminta reset password, abaikan email ini.</p>
              </div>
              <p style="margin:0;font-size:11px;color:#555;text-align:center;line-height:1.7;">Email ini dikirim otomatis oleh sistem Kuarta Bimbel.<br>Butuh bantuan? Hubungi kami di <a href="mailto:${process.env.SMTP_FROM}" style="color:#F97316;text-decoration:none;">${process.env.SMTP_FROM}</a></p>
            </td></tr>
            <tr><td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:11px;color:#444;">© ${new Date().getFullYear()} Kuarta Bimbel · All rights reserved</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>`,
  });
};

const sendVerificationEmail = async (name, email, token) => {
  const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  await client.transactionalEmails.sendTransacEmail({
    sender: { name: 'Kuarta Bimbel', email: process.env.SMTP_FROM },
    to: [{ email }],
    subject: 'Verifikasi Email — Kuarta Bimbel',
    htmlContent: `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#0F0F0F;font-family:'Segoe UI',sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F0F0F;padding:40px 16px;">
        <tr><td align="center">
          <table width="100%" style="max-width:480px;">
            <tr><td align="center" style="padding-bottom:28px;">
              <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#F97316,#ea6a0a);display:inline-flex;align-items:center;justify-content:center;font-size:26px;font-weight:900;color:#fff;text-align:center;line-height:56px;">K</div>
              <div style="margin-top:12px;font-size:22px;font-weight:800;color:#FFFFFF;">Kuarta Bimbel</div>
            </td></tr>
            <tr><td style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:20px;padding:32px;text-align:center;">
              <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#FFFFFF;">Halo, ${name}! 👋</p>
              <p style="margin:0 0 24px;font-size:13px;color:#888;line-height:1.7;">Terima kasih telah mendaftar di Kuarta. Klik tombol di bawah untuk memverifikasi email kamu.</p>
              <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#F97316,#ea6a0a);color:white;padding:14px 36px;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none;">Verifikasi Email</a>
              <p style="margin-top:24px;font-size:11px;color:#555;">Atau salin link ini: ${verifyUrl}</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>`,
  });
};

const router = Router();

const genTokens = (userId, tokenVersion = 0) => ({
  accessToken: jwt.sign({ userId, token_version: tokenVersion }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }),
  refreshToken: jwt.sign({ userId, type: 'refresh', token_version: tokenVersion }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, { expiresIn: '30d' }),
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
    if (name.length > 120) {
      return res.status(400).json({ error: 'Nama maksimal 120 karakter' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Format email tidak valid' });
    }

    const existing = await query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email sudah terdaftar' });
    }

    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const result = await query(
      `INSERT INTO users (name, email, password_hash, phone, city, email_verified, email_verify_token)
       VALUES ($1,$2,$3,$4,$5,false,$6) RETURNING id, name, email, role, plan, avatar_url, reward_points, streak_count`,
      [name.trim(), email.toLowerCase(), passwordHash, phone || null, city || null, verifyToken]
    );

    const user = result.rows[0];
    const tokens = genTokens(user.id, 0);

    await query(
      `INSERT INTO notifications (user_id, title, message, type) VALUES ($1,$2,$3,'success')`,
      [user.id, 'Selamat Bergabung! 🎉', `Halo ${user.name}! Verifikasi email kamu untuk mulai belajar.`]
    );

    try {
      await sendVerificationEmail(user.name, email.toLowerCase(), verifyToken);
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr.message);
    }

    res.status(201).json({ user, token: tokens.accessToken, refreshToken: tokens.refreshToken });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registrasi gagal' });
  }
});

// GET /api/auth/verify-email?token=...
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token verifikasi diperlukan' });

    const result = await query(
      `UPDATE users SET email_verified=true, email_verify_token=NULL
       WHERE email_verify_token=$1 AND email_verified=false
       RETURNING id, name, email`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: 'Token verifikasi tidak valid atau sudah digunakan' });
    }

    await query(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES ($1,'Email Terverifikasi! ✅','Email kamu berhasil diverifikasi. Selamat belajar!','success')`,
      [result.rows[0].id]
    );

    res.json({ message: 'Email berhasil diverifikasi! Silakan login.' });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Gagal memverifikasi email' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', authenticate, async (req, res) => {
  try {
    if (req.user.email_verified) {
      return res.json({ message: 'Email sudah terverifikasi' });
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');
    await query('UPDATE users SET email_verify_token=$1 WHERE id=$2', [verifyToken, req.user.id]);

    try {
      await sendVerificationEmail(req.user.name, req.user.email, verifyToken);
    } catch (emailErr) {
      console.error('Failed to resend verification email:', emailErr.message);
    }

    res.json({ message: 'Email verifikasi telah dikirim ulang.' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Gagal mengirim ulang verifikasi' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email dan password wajib diisi' });
    }

    const result = await query(
      'SELECT * FROM users WHERE email=$1 AND is_active=true',
      [email.toLowerCase().trim()]
    );

    if (!result.rows.length) {
      await bcrypt.compare(password, '$2a$12$' + 'a'.repeat(53));
      return res.status(401).json({ error: 'Email atau password salah' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Email atau password salah' });
    }

    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    const yesterdayObj = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterday = yesterdayObj.toISOString().split('T')[0];

    await query(`
      UPDATE users SET
        streak_count = CASE
          WHEN streak_last_date = $1::date THEN GREATEST(streak_count, 1)
          WHEN streak_last_date = $2::date THEN streak_count + 1
          ELSE 1
        END,
        streak_last_date = $1::date,
        last_login_at = NOW()
      WHERE id = $3`,
      [today, yesterday, user.id]
    );

    const updatedUser = await query(
      'SELECT id, name, email, phone, city, bio, role, plan, plan_expires_at, avatar_url, reward_points, streak_count, streak_last_date, target_exam, email_verified, token_version, created_at FROM users WHERE id=$1',
      [user.id]
    );

    const tokens = genTokens(user.id, updatedUser.rows[0].token_version || 0);
    const { password_hash, ...safeUser } = updatedUser.rows[0];

    res.json({
      user: safeUser,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
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

    const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(refreshToken, refreshSecret);
    if (decoded.type !== 'refresh') return res.status(401).json({ error: 'Token tidak valid' });

    const result = await query('SELECT id, token_version FROM users WHERE id=$1 AND is_active=true', [decoded.userId]);
    if (!result.rows.length) return res.status(401).json({ error: 'User tidak ditemukan' });

    const user = result.rows[0];
    if (decoded.token_version !== undefined && user.token_version !== decoded.token_version) {
      return res.status(401).json({ error: 'Token telah direvok. Silakan login ulang.', code: 'TOKEN_REVOKED' });
    }

    const tokens = genTokens(user.id, user.token_version || 0);
    res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken });
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
              u.streak_last_date, u.target_exam, u.created_at, u.email_verified,
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
    const { name, phone, city, bio, target_exam, avatar_url } = req.body;
    const result = await query(
      `UPDATE users SET name=COALESCE($1,name), phone=COALESCE($2,phone),
       city=COALESCE($3,city), bio=COALESCE($4,bio), target_exam=COALESCE($5,target_exam),
       avatar_url=COALESCE($6,avatar_url)
       WHERE id=$7 RETURNING id,name,email,phone,city,bio,target_exam,role,plan,avatar_url`,
      [name, phone, city, bio, target_exam, avatar_url, req.user.id]
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

    const hash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
    await query('UPDATE users SET password_hash=$1, token_version=COALESCE(token_version,0)+1 WHERE id=$2', [hash, req.user.id]);

    await query(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES ($1,'Password Diubah','Password akunmu berhasil diubah. Jika bukan kamu, segera hubungi kami.','warning')`,
      [req.user.id]
    );

    res.json({ message: 'Password berhasil diubah. Sesi lain telah diakhiri.' });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengubah password' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email wajib diisi' });

    const result = await query(
      'SELECT id, name FROM users WHERE email=$1 AND is_active=true',
      [email.toLowerCase().trim()]
    );

    if (!result.rows.length) {
      return res.json({ message: 'Jika email terdaftar, kode OTP telah dikirim.' });
    }

    const user = result.rows[0];
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user.id]);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at, attempt_count)
       VALUES ($1, $2, $3, 0)`,
      [user.id, otp, expiresAt]
    );

    try {
      await sendOtpEmail(user.name, email.toLowerCase().trim(), otp);
    } catch (emailErr) {
      await query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user.id]);
      console.error('Failed to send OTP email:', emailErr);
      return res.status(500).json({ error: 'Gagal mengirim email OTP. Coba lagi nanti.' });
    }

    res.json({ message: 'Jika email terdaftar, kode OTP telah dikirim.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Gagal memproses permintaan reset password' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email dan OTP wajib diisi' });
    }

    const tokenRes = await query(
      `SELECT prt.user_id, prt.attempt_count
       FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE u.email=$1 AND prt.expires_at > NOW() AND u.is_active=true
       ORDER BY prt.created_at DESC LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (!tokenRes.rows.length) {
      return res.status(400).json({ error: 'Kode OTP salah atau sudah kedaluwarsa' });
    }

    const { user_id, attempt_count } = tokenRes.rows[0];
    if (attempt_count >= 5) {
      await query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user_id]);
      return res.status(429).json({ error: 'Terlalu banyak percobaan. Silakan minta OTP baru.' });
    }

    const validToken = await query(
      `SELECT user_id FROM password_reset_tokens
       WHERE user_id=$1 AND token=$2 AND expires_at > NOW()`,
      [user_id, otp]
    );

    if (!validToken.rows.length) {
      await query('UPDATE password_reset_tokens SET attempt_count=attempt_count+1 WHERE user_id=$1', [user_id]);
      return res.status(400).json({ error: 'Kode OTP salah atau sudah kedaluwarsa' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiry = new Date(Date.now() + 15 * 60 * 1000);

    await query(
      `UPDATE password_reset_tokens SET token=$1, expires_at=$2, attempt_count=0 WHERE user_id=$3`,
      [resetToken, resetExpiry, user_id]
    );

    res.json({ resetToken });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Gagal memverifikasi OTP' });
  }
});

// POST /api/auth/reset-password
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
    const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    await query('UPDATE users SET password_hash=$1, token_version=COALESCE(token_version,0)+1 WHERE id=$2', [passwordHash, user_id]);
    await query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user_id]);

    await query(
      `INSERT INTO notifications (user_id, title, message, type)
       VALUES ($1, 'Password Diubah', 'Password akunmu baru saja berhasil direset. Jika bukan kamu, segera hubungi kami.', 'warning')`,
      [user_id]
    );

    res.json({ message: 'Password berhasil direset. Silakan login.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Gagal mereset password' });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GOOGLE SSO
══════════════════════════════════════════════════════════════════ */

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Credential tidak ditemukan' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'Gagal memverifikasi token Google' });
    }

    const { sub: googleId, email, name, picture } = payload;

    // Check if user exists by google_id
    let user = await query('SELECT * FROM users WHERE google_id=$1', [googleId]);

    if (user.rows.length) {
      // Existing Google user — login
      await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.rows[0].id]);
      const tokens = genTokens(user.rows[0].id, user.rows[0].token_version);
      return res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user: sanitizeUser(user.rows[0]) });
    }

    // Check if email already registered (link Google account)
    user = await query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (user.rows.length) {
      // Link Google ID to existing account
      await query('UPDATE users SET google_id=$1, avatar_url=COALESCE(avatar_url,$2), last_login_at=NOW() WHERE id=$3',
        [googleId, picture, user.rows[0].id]);
      const tokens = genTokens(user.rows[0].id, user.rows[0].token_version);
      return res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user: sanitizeUser({ ...user.rows[0], google_id: googleId }) });
    }

    // Create new user
    const result = await query(
      `INSERT INTO users (name, email, google_id, avatar_url, email_verified)
       VALUES ($1,$2,$3,$4,true) RETURNING *`,
      [name || email.split('@')[0], email.toLowerCase(), googleId, picture]
    );
    const tokens = genTokens(result.rows[0].id, result.rows[0].token_version);
    res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken, user: sanitizeUser(result.rows[0]) });
  } catch (err) {
    console.error('Google SSO error:', err);
    res.status(500).json({ error: 'Gagal login dengan Google' });
  }
});

function sanitizeUser(u) {
  const { password_hash, email_verify_token, token_version, ...safe } = u;
  return safe;
}

export default router;
