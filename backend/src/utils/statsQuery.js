import { pool } from '../db/pool.js';

/**
 * "Убийственная" сводная статистика игрока — используется и в его
 * собственном профиле, и при просмотре профиля друга.
 * ROI (Return on Investment) = чистая прибыль / сумма всех ставок * 100%.
 * Из-за встроенной в коэффициенты маржи букмекера (см. oddsService.js)
 * этот показатель на длинной дистанции стремится к отрицательному —
 * в этом и заключается образовательная идея проекта.
 */
export async function getUserStats(userId) {
  const { rows } = await pool.query(
    `SELECT
        COUNT(*)::int AS total_bets,
        COUNT(*) FILTER (WHERE status = 'won')::int AS won_bets,
        COUNT(*) FILTER (WHERE status = 'lost')::int AS lost_bets,
        COALESCE(SUM(amount), 0)::float8 AS total_staked,
        COALESCE(SUM(payout) FILTER (WHERE status = 'won'), 0)::float8 AS total_won,
        COALESCE(SUM(amount) FILTER (WHERE status = 'lost'), 0)::float8 AS total_lost
     FROM bets
     WHERE user_id = $1 AND status <> 'pending'`,
    [userId]
  );
  const s = rows[0];
  const netProfit = s.total_won - s.total_staked; // прибыль считаем только по уже сыгранным ставкам
  const roi = s.total_staked > 0 ? (netProfit / s.total_staked) * 100 : 0;
  const winRate = s.total_bets > 0 ? (s.won_bets / s.total_bets) * 100 : 0;

  return {
    totalBets: s.total_bets,
    wonBets: s.won_bets,
    lostBets: s.lost_bets,
    totalStaked: s.total_staked,
    totalWon: s.total_won,
    totalLost: s.total_lost,
    netProfit,
    roi,
    winRate,
  };
}
