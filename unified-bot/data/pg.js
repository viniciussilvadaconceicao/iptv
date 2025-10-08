import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

pool.on('error', (err) => {
  console.error('[PG] Erro no pool:', err?.message || err);
});