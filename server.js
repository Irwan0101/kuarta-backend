import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import programRoutes from './routes/programs.js';
import paymentRoutes from './routes/payment.js';
import tryoutRoutes from './routes/tryout.js';
import adminRoutes from './routes/admin.js';
import notifRoutes from './routes/notifications.js';
import liveRoutes from './routes/live.js';
import materiRoutes from './routes/materi.js';
import forumRoutes from './routes/forum.js';
import mentorRoutes from './routes/mentor.js';
import ratingsRoutes from './routes/ratings.js';
import certificatesRoutes from './routes/certificates.js';
import landingRoutes from './routes/landing.js';
import uploadRoutes from './routes/upload.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const REQUIRED_ENV = ['JWT_SECRET', 'MIDTRANS_SERVER_KEY', 'MIDTRANS_CLIENT_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}));

app.use(morgan('short'));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Terlalu banyak percobaan login. Coba lagi nanti.' } });
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Terlalu banyak permintaan OTP. Coba lagi nanti.' } });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
app.use('/api/auth/forgot-password', otpLimiter);
app.use('/api/auth/verify-otp', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.use('/api/auth/reset-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 200 }));

app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

app.use('/api/auth', authRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/tryout', tryoutRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/live', liveRoutes);
app.use('/api/materi', materiRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/mentor', mentorRoutes);
app.use('/api/ratings', ratingsRoutes);
app.use('/api/certificates', certificatesRoutes);
app.use('/api/landing', landingRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/uploads', express.static('uploads'));

app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} tidak ditemukan` }));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Terjadi kesalahan server. Coba lagi nanti.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║     KUARTA BIMBEL API — v1.0.0        ║
  ║  Server: http://localhost:${PORT}         ║
  ║  Env: ${(process.env.NODE_ENV || 'development').padEnd(10)}                    ║
  ╚═══════════════════════════════════════╝`);
});

const gracefulShutdown = async (signal) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    const { default: pool } = await import('./db/pool.js');
    await pool.end();
    console.log('Pool drained. Goodbye.');
    process.exit(0);
  });
  setTimeout(() => { console.error('Forced shutdown'); process.exit(1); }, 10000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
