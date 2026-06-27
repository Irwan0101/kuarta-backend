import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BrevoClient } = require('@getbrevo/brevo');

const ORG = '#FF6B00';

function formatRp(n) {
  return 'Rp' + Number(n).toLocaleString('id-ID');
}

export async function sendReceiptEmail({ name, email, orderId, programs, amount, serviceFee, discount, total, paidAt, paymentMethod }) {
  const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });
  const itemsHtml = programs.map((p, i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:${i < programs.length - 1 ? '1px solid #2A2A2A' : 'none'};">
        <div style="font-size:13px;font-weight:600;color:#fff;">${p.name}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;">${p.duration_months || ''} bulan akses</div>
      </td>
      <td style="padding:10px 0;border-bottom:${i < programs.length - 1 ? '1px solid #2A2A2A' : 'none'};text-align:right;font-size:13px;font-weight:600;color:#fff;">${formatRp(p.price)}</td>
    </tr>
  `).join('');

  await client.transactionalEmails.sendTransacEmail({
    sender: { name: 'Kuarta Bimbel', email: process.env.SMTP_FROM },
    to: [{ email }],
    subject: `Struk Pembayaran — ${orderId}`,
    htmlContent: `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background:#0F0F0F;font-family:'Segoe UI',sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F0F0F;padding:40px 16px;">
        <tr><td align="center">
          <table width="100%" style="max-width:520px;">
            <tr><td align="center" style="padding-bottom:28px;">
              <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#F97316,#ea6a0a);display:inline-flex;align-items:center;justify-content:center;box-shadow:0 8px 32px rgba(249,115,22,0.4);font-size:26px;font-weight:900;color:#fff;font-family:'Segoe UI',sans-serif;text-align:center;line-height:56px;">K</div>
              <div style="margin-top:12px;font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">Kuarta Bimbel</div>
            </td></tr>
            <tr><td style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:20px;padding:32px;">

              <div style="text-align:center;margin-bottom:28px;">
                <div style="width:52px;height:52px;border-radius:50%;background:rgba(34,197,94,0.15);display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
                  <span style="font-size:28px;">✅</span>
                </div>
                <div style="font-size:20px;font-weight:800;color:#fff;">Pembayaran Berhasil!</div>
                <div style="font-size:13px;color:#888;margin-top:4px;">Terima kasih, ${name}</div>
              </div>

              <div style="background:#111;border-radius:12px;padding:16px;margin-bottom:20px;">
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;margin-bottom:8px;">
                  <span>ID Pesanan</span>
                  <span style="font-weight:600;color:#fff;font-family:monospace;">${orderId}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;margin-bottom:8px;">
                  <span>Tanggal</span>
                  <span style="font-weight:600;color:#fff;">${paidAt}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:12px;color:#888;">
                  <span>Metode</span>
                  <span style="font-weight:600;color:#fff;text-transform:capitalize;">${(paymentMethod || '').replace(/_/g, ' ')}</span>
                </div>
              </div>

              <table width="100%" style="border-collapse:collapse;margin-bottom:16px;">
                <thead>
                  <tr>
                    <th style="padding:8px 0;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #2A2A2A;text-align:left;">Program</th>
                    <th style="padding:8px 0;font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid #2A2A2A;text-align:right;">Harga</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>

              <table width="100%" style="border-collapse:collapse;">
                ${serviceFee ? `<tr><td style="padding:6px 0;font-size:12px;color:#888;">Biaya layanan</td><td style="padding:6px 0;font-size:12px;color:#888;text-align:right;">${formatRp(serviceFee)}</td></tr>` : ''}
                ${discount ? `<tr><td style="padding:6px 0;font-size:12px;color:#22C55E;">Diskon</td><td style="padding:6px 0;font-size:12px;color:#22C55E;text-align:right;">-${formatRp(discount)}</td></tr>` : ''}
                <tr>
                  <td style="padding:10px 0;font-size:14px;font-weight:800;color:#fff;border-top:1px solid #2A2A2A;">Total Dibayar</td>
                  <td style="padding:10px 0;font-size:14px;font-weight:800;color:${ORG};text-align:right;border-top:1px solid #2A2A2A;">${formatRp(total)}</td>
                </tr>
              </table>

              <div style="border-top:1px solid #2A2A2A;margin:24px 0 16px;"></div>
              <p style="margin:0;font-size:12px;color:#666;line-height:1.7;text-align:center;">
                Kamu sudah bisa mengakses program yang dibeli sekarang.<br>
                <a href="${process.env.APP_URL || 'https://kuartabimbel.com'}/bimbelku" style="display:inline-block;margin-top:12px;padding:10px 24px;background:${ORG};color:#fff;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">Mulai Belajar</a>
              </p>
              <p style="margin:16px 0 0;font-size:11px;color:#444;text-align:center;">Email ini dikirim otomatis oleh Kuarta Bimbel. Hubungi kami jika ada pertanyaan.</p>

            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>`
  });
}
