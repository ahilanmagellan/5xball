// Общий клиент для бесплатного публичного API TheSportsDB (тестовый ключ "3").
// Используется и logoService.js (эмблемы), и fixturesService.js (реальное расписание).
// У бесплатного ключа есть ограничение: большинство "списочных" эндпоинтов
// отдают не больше ~5 записей — для лиг это как раз естественно ограничивает
// список матчами одного тура, что нам и нужно.
export const SPORTSDB_API_BASE = 'https://www.thesportsdb.com/api/v1/json/3';

export async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn(`[sportsdb] Не удалось получить ${url}: ${err.message}`);
    return null;
  }
}
