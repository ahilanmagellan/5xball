import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  console.log('Применяю schema.sql...');
  await pool.query(sql);
  console.log('Готово: таблицы users, leagues, matches, bets, friend_requests созданы (или уже существовали).');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Ошибка миграции:', err);
  process.exit(1);
});
