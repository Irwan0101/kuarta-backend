import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import programRoutes from './routes/programs.js';
import paymentRoutes from './routes/payment.js';
import tryoutRoutes from './routes/tryout.js';
import adminRoutes from './routes/admin.js';
import notifRoutes from './routes/notifications.js';
import liveRoutes from './routes/live.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ─── SECURITY ──────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}));

// ─── RATE LIMITING ─────────────────────────────────
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Terlalu banyak percobaan login. Coba lagi nanti.' } }));
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 200 }));

// ─── BODY PARSING ──────────────────────────────────
// Midtrans webhook needs raw body
app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── HEALTH CHECK ──────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  env: process.env.NODE_ENV,
  timestamp: new Date().toISOString(),
}));

// ─── ROUTES ────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/programs', programRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/tryout', tryoutRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/live', liveRoutes);

// ─── 404 ───────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} tidak ditemukan` }));

// ─── ERROR HANDLER ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Terjadi kesalahan server. Coba lagi nanti.' });
});

// ─── START ─────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║     KUARTA BIMBEL API — v1.0.0        ║
  ║  Server: http://localhost:${PORT}         ║
  ║  Env: ${(process.env.NODE_ENV || 'development').padEnd(10)}                   ║
  ╚═══════════════════════════════════════╝`);
});

export default app;