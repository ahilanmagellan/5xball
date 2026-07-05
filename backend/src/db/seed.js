import { pool } from './pool.js';
import { syncAllLeagues } from '../services/fixturesService.js';

/**
 * Заполняет БД лигами и матчами их ближайшего тура (см. fixturesService.js).
 * Использует реальное расписание из TheSportsDB, если оно доступно, иначе
 * откатывается на мок-генерацию. Безопасно запускать повторно — лиги
 * upsert'ятся по key, а новые матчи добавляются только если предыдущий
 * тур уже полностью сыгран/рассчитан.
 */
syncAllLeagues()
  .then(async () => {
    await pool.end();
    console.log('[seed] Готово.');
  })
  .catch((err) => {
    console.error('Ошибка сидирования:', err);
    process.exit(1);
  });
