import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// Единый пул соединений с PostgreSQL на всё приложение.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // Ошибка на "простаивающем" клиенте пула не должна ронять процесс
  console.error('Неожиданная ошибка в пуле PostgreSQL:', err);
});
