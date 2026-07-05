import { pool } from '../db/pool.js';

// Через сколько минут после стартового свистка матч считается "сыгранным"
// и по нему подбивается результат (в реальном проекте здесь был бы запрос
// к API результатов; в MVP результат симулируется, см. ниже).
const MATCH_DURATION_MINUTES = 105;

/**
 * Взвешенно "разыгрывает" исход матча на основе коэффициентов.
 * Кэфы уже содержат маржу букмекера (сумма 1/кэф > 1), поэтому мы сначала
 * нормализуем обратные коэффициенты в вероятности, суммирующиеся к 1 —
 * это и есть "справедливая" вероятность результата с точки зрения рынка.
 * Мат.ожидание ставки при этом равно amount / margin < amount, то есть
 * СТРОГО отрицательно для игрока при любом выборе исхода — именно так
 * букмекер гарантированно зарабатывает на дистанции.
 */
function drawResult(match) {
  const invHome = 1 / Number(match.odds_home);
  const invDraw = 1 / Number(match.odds_draw);
  const invAway = 1 / Number(match.odds_away);
  const sum = invHome + invDraw + invAway; // > 1, это и есть маржа букмекера

  const pHome = invHome / sum;
  const pDraw = invDraw / sum;
  // pAway = invAway / sum (не нужен явно — используем остаток)

  const r = Math.random();
  if (r < pHome) return 'H';
  if (r < pHome + pDraw) return 'D';
  return 'A';
}

async function settleBetsForMatch(client, matchId, result) {
  const { rows: bets } = await client.query(
    `SELECT * FROM bets WHERE match_id = $1 AND status = 'pending' FOR UPDATE`,
    [matchId]
  );

  for (const bet of bets) {
    if (bet.selection === result) {
      const payout = Number(bet.amount) * Number(bet.odds_at_bet);
      await client.query(
        `UPDATE bets SET status = 'won', payout = $1, settled_at = now() WHERE id = $2`,
        [payout, bet.id]
      );
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [payout, bet.user_id]);
    } else {
      await client.query(
        `UPDATE bets SET status = 'lost', payout = 0, settled_at = now() WHERE id = $1`,
        [bet.id]
      );
    }
  }
}

/**
 * Находит матчи, которые "должны были уже закончиться", разыгрывает
 * результат и рассчитывает по ним все ожидающие ставки.
 * В проде эту функцию нужно заменить на подтягивание реальных
 * результатов (scores endpoint The Odds API или другой источник) —
 * структура таблиц и логика расчёта ставок при этом не меняются.
 */
export async function simulateAndSettleFinishedMatches() {
  const { rows: dueMatches } = await pool.query(
    `SELECT * FROM matches
      WHERE status = 'scheduled' AND commence_time <= now() - ($1 || ' minutes')::interval`,
    [MATCH_DURATION_MINUTES]
  );

  for (const match of dueMatches) {
    const result = drawResult(match);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE matches SET status = 'finished', result = $1, is_frozen = true WHERE id = $2`,
        [result, match.id]
      );
      await settleBetsForMatch(client, match.id, result);
      await client.query('COMMIT');
      console.log(`[settlement] Матч #${match.id} (${match.home_team} - ${match.away_team}) завершён: ${result}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[settlement] Ошибка расчёта матча #${match.id}:`, err);
    } finally {
      client.release();
    }
  }
}
