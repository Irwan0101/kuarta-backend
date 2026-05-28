import { Router } from 'express';
import midtransClient from 'midtrans-client';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Initialize Midtrans Snap
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Initialize Core API (for webhook verification)
const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY,
});

// POST /api/payment/create  — create Midtrans Snap token
// POST /api/payment/create  — create Midtrans Snap token
router.post('/create', authenticate, async (req, res) => {
  try {
    const { program_id } = req.body;
    if (!program_id) return res.status(400).json({ error: 'program_id wajib diisi' });

    // Get program
    const progResult = await query('SELECT * FROM programs WHERE id=$1 AND is_active=true', [program_id]);
    if (!progResult.rows.length) return res.status(404).json({ error: 'Program tidak ditemukan' });
    const program = progResult.rows[0];

    // Check already enrolled
    const enrolled = await query(
      'SELECT id FROM user_programs WHERE user_id=$1 AND program_id=$2 AND is_active=true',
      [req.user.id, program_id]
    );
    if (enrolled.rows.length) {
      return res.status(409).json({ error: 'Kamu sudah terdaftar di program ini' });
    }

    // Check pending transaction
    const existing = await query(
      `SELECT order_id, snap_token FROM transactions
       WHERE user_id=$1 AND program_id=$2 AND status='pending' AND expired_at > NOW()`,
      [req.user.id, program_id]
    );
    if (existing.rows.length && existing.rows[0].snap_token) {
      return res.json({ snap_token: existing.rows[0].snap_token, order_id: existing.rows[0].order_id });
    }

    // 🌟 PERBAIKAN: Paksa program.price menjadi tipe data Number murni
    const programPrice = Number(program.price); 
    const orderId = `KRT-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;
    const serviceFee = 5000;
    const grossAmount = programPrice + serviceFee; // Sekarang menghasilkan nilai: 855000 (Number)

    // Create Midtrans Snap transaction
    const snapParam = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount, // Sudah aman bertipe Number
      },
      item_details: [
        { 
          id: program.id, 
          price: programPrice, // 🌟 Diubah ke variabel angka murni
          quantity: 1, 
          name: program.name.substring(0, 50) // Amankan panjang karakter teks nama item untuk Midtrans
        },
        { 
          id: 'SERVICE-FEE', 
          price: serviceFee, 
          quantity: 1, 
          name: 'Biaya Layanan' 
        },
      ],
      customer_details: {
        first_name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
      },
      callbacks: {
        finish: `${process.env.FRONTEND_URL}/payment/finish?order_id=${orderId}`,
        error: `${process.env.FRONTEND_URL}/payment/error?order_id=${orderId}`,
        pending: `${process.env.FRONTEND_URL}/payment/pending?order_id=${orderId}`,
      },
      expiry: { unit: 'hours', duration: 24 },
    };

    const snapRes = await snap.createTransaction(snapParam);

    // Save transaction to DB
    await query(`
      INSERT INTO transactions (order_id, user_id, program_id, amount, service_fee, gross_amount,
                                status, snap_token, expired_at)
      VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,NOW()+INTERVAL '24 hours')`,
      [orderId, req.user.id, program_id, programPrice, serviceFee, grossAmount, snapRes.token] // 🌟 Simpan sebagai Number murni agar data di DB rapi
    );

    res.json({ snap_token: snapRes.token, order_id: orderId, client_key: process.env.MIDTRANS_CLIENT_KEY });
  } catch (err) {
    console.error('Payment create error:', err);
    res.status(500).json({ error: 'Gagal membuat transaksi pembayaran' });
  }
});
// POST /api/payment/webhook  — Midtrans notification handler
router.post('/webhook', async (req, res) => {
  try {
    const notif = req.body;
    const orderId = notif.order_id;

    // Verify with Midtrans
    let statusResponse;
    try {
      statusResponse = await coreApi.transaction.notification(notif);
    } catch (e) {
      console.error('Midtrans verification failed:', e.message);
      return res.status(400).json({ error: 'Notification tidak valid' });
    }

    const { transaction_status, fraud_status, payment_type } = statusResponse;
    let newStatus = 'pending';

    if (transaction_status === 'capture') {
      newStatus = fraud_status === 'accept' ? 'success' : 'failed';
    } else if (transaction_status === 'settlement') {
      newStatus = 'success';
    } else if (['cancel', 'deny', 'expire'].includes(transaction_status)) {
      newStatus = transaction_status === 'expire' ? 'expire' : 'failed';
    } else if (transaction_status === 'refund') {
      newStatus = 'refund';
    }

    // Update transaction
    const txResult = await query(`
      UPDATE transactions
      SET status=$1, payment_method=$2, midtrans_response=$3::jsonb,
          paid_at=CASE WHEN $1='success' THEN NOW() ELSE NULL END
      WHERE order_id=$4 AND status != 'success'
      RETURNING user_id, program_id, amount`,
      [newStatus, payment_type || 'unknown', JSON.stringify(statusResponse), orderId]
    );

    // If success — activate enrollment
    if (newStatus === 'success' && txResult.rows.length) {
      const { user_id, program_id, amount } = txResult.rows[0];

      await query(`
        INSERT INTO user_programs (user_id, program_id, expires_at)
        VALUES ($1,$2,NOW()+INTERVAL '1 month' * (SELECT duration_months FROM programs WHERE id=$2))
        ON CONFLICT (user_id, program_id) DO UPDATE SET is_active=true, expires_at=EXCLUDED.expires_at`,
        [user_id, program_id]
      );

      // Update program student_count
      await query('UPDATE programs SET student_count=student_count+1 WHERE id=$1', [program_id]);

      // Award reward points
      const points = Math.floor(amount / 10000);
      await query('UPDATE users SET reward_points=reward_points+$1 WHERE id=$2', [points, user_id]);

      // Notification
      const prog = await query('SELECT name FROM programs WHERE id=$1', [program_id]);
      if (prog.rows.length) {
        await query(`
          INSERT INTO notifications (user_id, title, message, type)
          VALUES ($1,$2,$3,'success')`,
          [user_id, 'Pembayaran Berhasil! ✅',
           `Program ${prog.rows[0].name} sudah aktif. Mulai belajar sekarang!`]
        );
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

// GET /api/payment/history
router.get('/history', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(`
      SELECT t.*, p.name as program_name, p.icon as program_icon, p.category as program_category
      FROM transactions t
      LEFT JOIN programs p ON p.id=t.program_id
      WHERE t.user_id=$1
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const total = await query('SELECT COUNT(*) FROM transactions WHERE user_id=$1', [req.user.id]);

    res.json({
      transactions: result.rows,
      total: parseInt(total.rows[0].count),
      page: parseInt(page),
      pages: Math.ceil(total.rows[0].count / limit),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil riwayat pembayaran' });
  }
});

// GET /api/payment/status/:orderId
router.get('/status/:orderId', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT t.*, p.name as program_name FROM transactions t
       LEFT JOIN programs p ON p.id=t.program_id
       WHERE t.order_id=$1 AND t.user_id=$2`,
      [req.params.orderId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil status pembayaran' });
  }
});

// GET /api/payment/admin/all  (admin)
router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = '';
    if (status) { params.push(status); where = `WHERE t.status=$1`; }
    params.push(limit, offset);

    const result = await query(`
      SELECT t.*, u.name as user_name, u.email as user_email, p.name as program_name
      FROM transactions t
      LEFT JOIN users u ON u.id=t.user_id
      LEFT JOIN programs p ON p.id=t.program_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );
    const total = await query(`SELECT COUNT(*), SUM(CASE WHEN status='success' THEN gross_amount ELSE 0 END) as revenue FROM transactions ${where}`, status ? [status] : []);
    res.json({ transactions: result.rows, ...total.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data transaksi' });
  }
});

export default router;