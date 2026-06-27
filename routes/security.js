import { Router } from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import { query } from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

function run(cmd) {
  return new Promise(resolve => {
    exec(cmd, { timeout: 8000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || '').trim(), err: (stderr || '').trim() });
    });
  });
}

/* ─── Overview ─── */

router.get('/overview', async (req, res) => {
  try {
    const [fail2ban, sslInfo, diskUsage, uptimeRes, loginAttempts, failedReq, poolStatus, recentChanges, firewall, sshSessions] =
      await Promise.all([
        getFail2banStatus(),
        getSslExpiry(),
        run('df -h / --output=avail,pcent | tail -1'),
        run('uptime -p'),
        getLoginAttempts(),
        getFailedRequests(),
        getPoolStatus(),
        getRecentChanges(),
        getFirewallStatus(),
        run("who | wc -l"),
      ]);

    const mem = {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      pct: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
    };

    res.json({
      server: {
        hostname: os.hostname(),
        platform: os.platform(),
        uptime: uptimeRes.out || `${Math.floor(os.uptime() / 86400)} days`,
        cpu: os.cpus().length + ' core',
        load: os.loadavg().slice(0, 3),
        mem,
        disk: parseDisk(diskUsage),
        time: new Date().toISOString(),
      },
      fail2ban: fail2ban || { ok: false, msg: 'fail2ban tidak terinstall' },
      ssl: sslInfo || { ok: false, msg: 'SSL cert tidak ditemukan' },
      firewall: firewall || { ok: false, msg: 'firewall tidak terdeteksi' },
      login: loginAttempts,
      requests: failedReq,
      pool: poolStatus,
      integrity: recentChanges,
      ssh: { sessions: parseInt(sshSessions.out) || 0 },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat data keamanan' });
  }
});

/* ─── Helpers ─── */

async function getFail2banStatus() {
  const r = await run('fail2ban-client status 2>/dev/null || echo "NOT_INSTALLED"');
  if (r.out === 'NOT_INSTALLED' || !r.ok) return null;
  const jails = r.out.match(/Jail list:\s*(.+)/);
  if (!jails) return { ok: true, jails: [], totalBanned: 0 };
  const names = jails[1].split(/,\s*/).filter(Boolean);
  const details = await Promise.all(names.map(async n => {
    const s = await run(`fail2ban-client status ${n} 2>/dev/null`);
    const banned = s.out.match(/Currently banned:\s*(\d+)/);
    const total = s.out.match(/Total banned:\s*(\d+)/);
    return { name: n, currentlyBanned: parseInt(banned?.[1]) || 0, totalBanned: parseInt(total?.[1]) || 0 };
  }));
  return {
    ok: true,
    jails: details,
    totalBanned: details.reduce((a, b) => a + b.totalBanned, 0),
    currentlyBanned: details.reduce((a, b) => a + b.currentlyBanned, 0),
  };
}

async function getSslExpiry() {
  const r = await run("openssl x509 -enddate -noout -in /etc/letsencrypt/live/kuartabimbel.com/fullchain.pem 2>/dev/null || echo 'NOT_FOUND'");
  if (r.out === 'NOT_FOUND') return null;
  const match = r.out.match(/notAfter=(.+)/);
  if (!match) return null;
  const expiry = new Date(match[1]);
  const daysLeft = Math.floor((expiry - new Date()) / 86400000);
  return {
    expiryDate: expiry.toISOString(),
    daysLeft,
    status: daysLeft < 0 ? 'expired' : daysLeft < 7 ? 'critical' : daysLeft < 30 ? 'warning' : 'ok',
  };
}

async function getLoginAttempts() {
  const failed = await query(`
    SELECT COUNT(*)::int AS total FROM audit_logs
    WHERE entity_type='auth' AND action='login_failed'
    AND created_at > NOW() - INTERVAL '7 days'
  `).catch(() => ({ rows: [{ total: 0 }] }));

  const lastFailed = await query(`
    SELECT created_at, ip_address, admin_name FROM audit_logs
    WHERE entity_type='auth' AND action='login_failed'
    ORDER BY created_at DESC LIMIT 5
  `).catch(() => ({ rows: [] }));

  const recentSuccess = await query(`
    SELECT COUNT(*)::int AS total FROM audit_logs
    WHERE entity_type='auth' AND action='login_success'
    AND created_at > NOW() - INTERVAL '24 hours'
  `).catch(() => ({ rows: [{ total: 0 }] }));

  return {
    failed7d: failed.rows[0]?.total || 0,
    success24h: recentSuccess.rows[0]?.total || 0,
    lastFailed: lastFailed.rows || [],
  };
}

async function getFailedRequests() {
  const r = await run("tail -5000 /var/log/nginx/access.log 2>/dev/null | grep -cE ' \"(404|500|403|429|400) ' || echo 0");
  const lines = parseInt(r.out) || 0;

  const ipCounts = await run(
    "tail -20000 /var/log/nginx/access.log 2>/dev/null | grep -E ' (400|403|404|429|500|502|503) ' | awk '{print $1}' | sort | uniq -c | sort -rn | head -10"
  );

  return {
    badRequests7d: lines,
    topIps: ipCounts.out ? ipCounts.out.split('\n').filter(Boolean).map(l => {
      const m = l.trim().match(/^(\d+)\s(.+)/);
      return m ? { count: parseInt(m[1]), ip: m[2] } : null;
    }).filter(Boolean) : [],
  };
}

async function getPoolStatus() {
  try {
    const r = await query(`SELECT count(*)::int AS total FROM pg_stat_activity WHERE state='active'`);
    return { activeConnections: r.rows[0]?.total || 0 };
  } catch {
    return { activeConnections: 0 };
  }
}

async function getRecentChanges() {
  const dirs = ['/var/www/kuarta-v2', '/etc/nginx'];
  const changes = [];
  for (const dir of dirs) {
    const r = await run(`find ${dir} -maxdepth 3 -type f -mmin -1440 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/log/*' -not -path '*/cache/*' 2>/dev/null | head -20`);
    if (r.out) changes.push({ dir, files: r.out.split('\n').length, sample: r.out.split('\n').slice(0, 5) });
  }
  return changes;
}

async function getFirewallStatus() {
  const ufw = await run('ufw status 2>/dev/null || echo "NOT"');
  if (ufw.out !== 'NOT' && ufw.out.includes('active')) return { type: 'ufw', ok: true };
  const iptables = await run('iptables -L -n 2>/dev/null | head -5 || echo "NOT"');
  if (!iptables.out.includes('NOT')) return { type: 'iptables', ok: true };
  return null;
}

function parseDisk(d) {
  if (!d.ok) return { available: '?', usedPct: '?' };
  const parts = d.out.trim().split(/\s+/);
  return { available: parts[0] || '?', usedPct: parts[1] || '?' };
}

export default router;
