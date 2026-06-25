import { Router } from 'express';
import midtransClient from 'midtrans-client';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const snap = new midtransClient.Snap({
  isProduction,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});
const coreApi = new midtransClient.CoreApi({
  isProduction,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
});

// POST /api/payment/validate-coupon
router.post('/validate-coupon', authenticate, async (req, res) => {
  try {
    const { coupon_code, program_id } = req.body;
    if (!coupon_code) return res.status(400).json({ error: 'Kode kupon wajib diisi' });

    const result = await query(
      `SELECT * FROM coupons
       WHERE code=$1 AND is_active=true
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (max_uses = 0 OR use_count < max_uses)`,
      [coupon_code.toUpperCase()]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Kode kupon tidak valid atau sudah kadaluwarsa' });

    const coupon = result.rows[0];
    if (coupon.program_id && coupon.program_id !== program_id) {
      return res.status(400).json({ error: 'Kupon tidak berlaku untuk program ini' });
    }

    let discount = 0;
    if (program_id) {
      const prog = await query('SELECT price FROM programs WHERE id=$1', [program_id]);
      if (prog.rows.length) {
        const price = Number(prog.rows[0].price);
        if (coupon.min_purchase > 0 && price < coupon.min_purchase) {
          return res.status(400).json({ error: `Min. pembelian Rp ${coupon.min_purchase.toLocaleString('id-ID')}` });
        }
        discount = coupon.type === 'percent'
          ? Math.floor(price * coupon.value / 100)
          : coupon.value;
      }
    }

    res.json({
      valid: true,
      coupon: { id: coupon.id, code: coupon.code, type: coupon.type, value: coupon.value },
      discount,
    });
  } catch (err) {
    console.error('Validate coupon error:', err);
    res.status(500).json({ error: 'Gagal memvalidasi kupon' });
  }
});

// POST /api/payment/create
router.post('/create', authenticate, async (req, res) => {
  try {
    const { program_id, items: reqItems, coupon_code } = req.body;

    // Support both single program_id and multi-item array
    let items = [];
    if (reqItems && Array.isArray(reqItems) && reqItems.length > 0) {
      items = reqItems;
    } else if (program_id) {
      items = [{ program_id }];
    } else {
      return res.status(400).json({ error: 'program_id atau items wajib diisi' });
    }

    // Resolve all programs
    const ids = items.map(i => i.program_id);
    const progResult = await query(
      `SELECT * FROM programs WHERE id = ANY($1::uuid[]) AND is_active=true`,
      [ids]
    );
    if (progResult.rows.length !== ids.length) {
      return res.status(404).json({ error: 'Beberapa program tidak ditemukan atau tidak aktif' });
    }
    const programs = progResult.rows;

    // Check existing pending transaction for the first item (for single-item reuse)
    if (items.length === 1 && program_id) {
      const existing = await query(
        `SELECT order_id, snap_token FROM transactions
         WHERE user_id=$1 AND program_id=$2 AND status='pending' AND expired_at > NOW()`,
        [req.user.id, program_id]
      );
      if (existing.rows.length && existing.rows[0].snap_token) {
        return res.json({ snap_token: existing.rows[0].snap_token, order_id: existing.rows[0].order_id });
      }
    }

    // Check enrollment for all programs
    const enrolled = await query(
      `SELECT program_id FROM user_programs
       WHERE user_id=$1 AND program_id = ANY($2::uuid[]) AND is_active=true`,
      [req.user.id, ids]
    );
    if (enrolled.rows.length) {
      const enrolledIds = enrolled.rows.map(r => r.program_id);
      return res.status(409).json({
        error: 'Kamu sudah terdaftar di beberapa program',
        enrolled: enrolledIds,
      });
    }

    const serviceFee = parseInt(process.env.SERVICE_FEE) || 5000;
    const orderId = `KRT-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;

    // Build item_details for Midtrans
    let totalAmount = 0;
    let discount = 0;
    let couponId = null;
    const midtransItems = [];
    const orderProgramIds = [];

    for (const p of programs) {
      const price = Number(p.price);
      const qty = items.find(i => i.program_id === p.id)?.quantity || 1;
      totalAmount += price * qty;
      orderProgramIds.push(p.id);
      midtransItems.push({
        id: p.id,
        price,
        quantity: qty,
        name: p.name.substring(0, 50),
      });
    }

    // Apply coupon
    if (coupon_code) {
      const cpn = await query(
        `SELECT * FROM coupons WHERE code=$1 AND is_active=true
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (max_uses = 0 OR use_count < max_uses)`,
        [coupon_code.toUpperCase()]
      );
      if (cpn.rows.length) {
        const c = cpn.rows[0];
        if (!c.program_id || ids.includes(c.program_id)) {
          discount = c.type === 'percent' ? Math.floor(totalAmount * c.value / 100) : c.value;
          couponId = c.id;
        }
      }
    }

    const discountedAmount = Math.max(0, totalAmount - discount);
    const grossAmount = discountedAmount + serviceFee;

    if (discount > 0) {
      midtransItems.push({ id: 'DISCOUNT', price: -discount, quantity: 1, name: 'Diskon Kupon' });
    }
    midtransItems.push({ id: 'SERVICE-FEE', price: serviceFee, quantity: 1, name: 'Biaya Layanan' });

    const snapParam = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
      item_details: midtransItems,
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

    if (couponId) {
      await query('UPDATE coupons SET use_count=use_count+1 WHERE id=$1', [couponId]);
    }

    // Store items as JSONB in transactions (backward compatible: program_id = first program)
    const itemsJson = JSON.stringify(orderProgramIds.map(id => {
      const p = programs.find(pr => pr.id === id);
      return { program_id: id, name: p?.name, price: Number(p?.price || 0) };
    }));

    await query(`
      INSERT INTO transactions (order_id, user_id, program_id, amount, service_fee, gross_amount,
                                discount, items, status, snap_token, expired_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'pending',$9,NOW()+INTERVAL '24 hours')`,
      [orderId, req.user.id, orderProgramIds[0], totalAmount, serviceFee, grossAmount, discount,
       itemsJson, snapRes.token]
    );

    res.json({ snap_token: snapRes.token, order_id: orderId, multi: orderProgramIds.length > 1 });
  } catch (err) {
    console.error('Payment create error:', err);
    res.status(500).json({ error: 'Gagal membuat transaksi pembayaran' });
  }
});

// POST /api/payment/webhook
router.post('/webhook', async (req, res) => {
  try {
    const notif = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    const orderId = notif.order_id;

    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const signature = crypto.createHmac('sha512', serverKey)
      .update(orderId + (notif.status_code || '') + (notif.gross_amount || '') + serverKey)
      .digest('hex');

    if (notif.signature_key && notif.signature_key !== signature) {
      console.error('Webhook signature mismatch');
      return res.status(400).json({ error: 'Signature tidak valid' });
    }

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

    const txResult = await query(`
      UPDATE transactions
      SET status=$1, payment_method=$2, midtrans_response=$3::jsonb,
          paid_at=CASE WHEN $1='success' THEN NOW() ELSE NULL END
      WHERE order_id=$4 AND status NOT IN ('success','refund')
      RETURNING user_id, program_id, amount, items, status as old_status`,
      [newStatus, payment_type || 'unknown', JSON.stringify(statusResponse), orderId]
    );

    if (newStatus === 'success' && txResult.rows.length) {
      const { user_id, program_id, amount, items: txItems } = txResult.rows[0];

      // Handle multi-item enrollment
      let programIds = [];
      if (txItems && Array.isArray(txItems) && txItems.length > 0) {
        programIds = txItems.map(i => i.program_id);
      } else if (program_id) {
        programIds = [program_id];
      }

      for (const pid of programIds) {
        await query(`
          INSERT INTO user_programs (user_id, program_id, expires_at)
          VALUES ($1,$2,NOW()+INTERVAL '1 month' * (SELECT duration_months FROM programs WHERE id=$2))
          ON CONFLICT (user_id, program_id) DO UPDATE SET is_active=true, expires_at=EXCLUDED.expires_at`,
          [user_id, pid]
        );

        await query('UPDATE programs SET student_count=student_count+1 WHERE id=$1', [pid]);
      }

      // Set user as premium after first purchase
      await query(`UPDATE users SET plan='premium' WHERE id=$1 AND plan NOT IN ('premium','vip')`, [user_id]);

      const points = Math.floor(amount / 10000);
      await query('UPDATE users SET reward_points=reward_points+$1 WHERE id=$2', [points, user_id]);

      // Notify user
      const progNames = await query(
        `SELECT name FROM programs WHERE id = ANY($1::uuid[])`,
        [programIds]
      );
      const names = progNames.rows.map(r => r.name).join(', ');
      await query(`
        INSERT INTO notifications (user_id, title, message, type)
        VALUES ($1,$2,$3,'success')`,
        [user_id, 'Pembayaran Berhasil! ✅',
         names ? `Program ${names} sudah aktif. Mulai belajar sekarang!` : 'Pembayaran berhasil.']
      );
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

// GET /api/payment/admin/all (admin)
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
