import cron from 'node-cron';
import { reconcileOdds } from '../services/oddsService.js';
import { simulateAndSettleFinishedMatches } from '../services/settlementService.js';
import { syncAllLeagues } from '../services/fixturesService.js';

/**
 * Периодические фоновые задачи:
 *  - reconcileOdds: раз в 15 минут проверяет, каким матчам пора обновить
 *    коэффициенты (правило "раз в 1-2 суток / раз в час перед матчем /
 *    заморозка при старте" применяется внутри самой функции по времени).
 *  - simulateAndSettleFinishedMatches: раз в 5 минут "доигрывает" матчи,
 *    время которых уже прошло, и рассчитывает ставки по ним.
 *  - syncAllLeagues: раз в 30 минут проверяет, не закончился ли у какой-то
 *    лиги текущий тур (все матчи status='finished'), и если да — подтягивает
 *    следующий реальный тур. Так список актуальных матчей поддерживает
 *    себя сам, без ручных перезапусков `npm run seed`.
 * Частота тиков крона выше, чем сами правила обновления, — это нормально:
 * функции идемпотентны и просто ничего не делают, если ещё не пора.
 */
export function startOddsCron() {
  cron.schedule('*/15 * * * *', () => {
    reconcileOdds().catch((err) => console.error('[cron] reconcileOdds:', err));
  });

  cron.schedule('*/5 * * * *', async () => {
    try {
      await simulateAndSettleFinishedMatches();
      await syncAllLeagues(); // сразу подтягиваем новый тур, если предыдущий только что досчитался
    } catch (err) {
      console.error('[cron] settlement/fixtures:', err);
    }
  });

  // Прогоняем сразу при старте сервера, не дожидаясь первого тика
  (async () => {
    try {
      await reconcileOdds();
      await simulateAndSettleFinishedMatches();
      await syncAllLeagues();
    } catch (err) {
      console.error('[cron] Начальный прогон:', err);
    }
  })();

  console.log('[cron] Фоновые задачи по коэффициентам, расчёту ставок и обновлению туров запущены');
}
