import dotenv from 'dotenv';
dotenv.config();
import pg from 'pg';

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;

const pool = new Pool({
  // Jika ada DATABASE_URL (di Render), pakai URL utuh dari Neon.
  // Jika tidak ada (di lokal), pakai object konfigurasi pecahan bawah ini.
  connectionString: process.env.DATABASE_URL || undefined,
  
  host: process.env.DATABASE_URL ? undefined : (process.env.DB_HOST || 'localhost'),
  port: process.env.DATABASE_URL ? undefined : (parseInt(process.env.DB_PORT) || 5432),
  database: process.env.DATABASE_URL ? undefined : (process.env.DB_NAME || 'kuarta_db'),
  user: process.env.DATABASE_URL ? undefined : (process.env.DB_USER || 'postgres'),
  password: process.env.DATABASE_URL ? undefined : process.env.DB_PASSWORD,
  
  // Setingan optimal untuk pool tetap dipertahankan
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  
  // Neon WAJIB SSL, di lokal tidak perlu
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

export const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('query', { text: text.slice(0, 60), duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

export const getClient = () => pool.connect();

export default pool;