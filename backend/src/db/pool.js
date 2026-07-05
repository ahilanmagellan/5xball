import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// Управляемые облачные Postgres (Neon, Supabase, Render Postgres и т.п.)
// требуют SSL и обычно используют самоподписанный сертификат для цепочки
// доверия — поэтому проверку сертификата отключаем. Локальную БД (localhost)
// это не затрагивает — там SSL просто не включаем.
const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '');

// Единый пул соединений с PostgreSQL на всё приложение.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  // Ошибка на "простаивающем" клиенте пула не должна ронять процесс
  console.error('Неожиданная ошибка в пуле PostgreSQL:', err);
});
