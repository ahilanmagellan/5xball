import { Router } from 'express';
import { pool } from '../db/pool.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/leagues — список турниров для верхних табов вкладки "Матчи"
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT id, key, name, logo_url FROM leagues ORDER BY sort_order');
  res.json({ leagues: rows });
}));

// GET /api/leagues/:key/matches — предстоящие матчи лиги (с эмблемами команд из кэша team_logos)
router.get('/:key/matches', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.home_team, m.away_team, m.commence_time, m.round_number,
            m.odds_home, m.odds_draw, m.odds_away, m.is_frozen,
            hl.logo_url AS home_logo, al.logo_url AS away_logo
       FROM matches m
       JOIN leagues l ON l.id = m.league_id
       LEFT JOIN team_logos hl ON hl.team_name = m.home_team
       LEFT JOIN team_logos al ON al.team_name = m.away_team
      WHERE l.key = $1 AND m.status = 'scheduled'
      ORDER BY m.commence_time ASC`,
    [req.params.key]
  );
  res.json({ matches: rows });
}));

// GET /api/leagues/:key/stats — статистика ТЕКУЩЕГО пользователя именно по этой лиге
// (для шапки: "Поставлено: X / Выиграно: Y / Проиграно: Z")
router.get('/:key/stats', requireAuth, asyncHandler(async (req, res) => {
  const { rows: leagueRows } = await pool.query('SELECT id FROM leagues WHERE key = $1', [req.params.key]);
  const league = leagueRows[0];
  if (!league) throw new HttpError(404, 'Лига не найдена');

  const { rows } = await pool.query(
    `SELECT
        COALESCE(SUM(amount), 0)::float8 AS staked,
        COALESCE(SUM(payout) FILTER (WHERE status = 'won'), 0)::float8 AS won,
        COALESCE(SUM(amount) FILTER (WHERE status = 'lost'), 0)::float8 AS lost
     FROM bets
     WHERE user_id = $1 AND league_id = $2`,
    [req.userId, league.id]
  );
  res.json({ stats: rows[0] });
}));

export default router;
