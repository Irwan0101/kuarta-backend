import { query } from './db/pool.js';

const users = await query(`SELECT COUNT(*) as total FROM users WHERE role='user'`);
const programs = await query(`SELECT COUNT(*) as total FROM programs`);
const tryouts = await query(`SELECT COUNT(*) as total FROM tryout_packages`);
const activeSessions = await query(`SELECT COUNT(*) as total FROM tryout_results WHERE started_at >= NOW()-INTERVAL '2 hours' AND finished_at IS NULL`);
const revenue = await query(`SELECT COALESCE(SUM(gross_amount) FILTER (WHERE status='success'), 0) as total_revenue FROM transactions`);
const newToday = await query(`SELECT COUNT(*) as total FROM users WHERE role='user' AND created_at >= CURRENT_DATE`);

console.log(JSON.stringify({
  total_users: parseInt(users.rows[0]?.total ?? 0),
  total_programs: parseInt(programs.rows[0]?.total ?? 0),
  total_tryouts: parseInt(tryouts.rows[0]?.total ?? 0),
  active_sessions: parseInt(activeSessions.rows[0]?.total ?? 0),
  total_revenue: parseFloat(revenue.rows[0]?.total_revenue ?? 0),
  new_users_today: parseInt(newToday.rows[0]?.total ?? 0),
}));
