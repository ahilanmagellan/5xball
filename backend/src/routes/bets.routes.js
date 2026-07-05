import { Router } from 'express';
import { pool } from '../db/pool.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const VALID_SELECTIONS = new Set(['H', 'D', 'A']);

// POST /api/bets { match_id, selection: 'H'|'D'|'A', amount }
router.post('/', asyncHandler(async (req, res) => {
  const { match_id, selection, amount } = req.body || {};
  const amountNum = Number(amount);

  if (!VALID_SELECTIONS.has(selection)) throw new HttpError(400, 'Некорректный исход (ожидается H, D или A)');
  if (!Number.isFinite(amountNum) || amountNum <= 0) throw new HttpError(400, 'Некорректная сумма ставки');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Блокируем строку пользователя, чтобы параллельные ставки не увели баланс в минус
    const { rows: userRows } = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.userId]);
    const balance = Number(userRows[0].balance);
    if (amountNum > balance) throw new HttpError(400, 'Недостаточно средств на балансе');

    const { rows: matchRows } = await client.query('SELECT * FROM matches WHERE id = $1 FOR UPDATE', [match_id]);
    const match = matchRows[0];
    if (!match) throw new HttpError(404, 'Матч не найден');
    if (match.status !== 'scheduled' || new Date(match.commence_time) <= new Date()) {
      throw new HttpError(400, 'Матч уже начался, ставки закрыты');
    }

    const oddsBySelection = { H: match.odds_home, D: match.odds_draw, A: match.odds_away };
    const oddsAtBet = oddsBySelection[selection];

    const { rows: betRows } = await client.query(
      `INSERT INTO bets (user_id, match_id, league_id, selection, amount, odds_at_bet)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.userId, match.id, match.league_id, selection, amountNum, oddsAtBet]
    );

    const { rows: updatedUser } = await client.query(
      'UPDATE users SET balance = balance - $1 WHERE id = $2 RETURNING balance',
      [amountNum, req.userId]
    );

    await client.query('COMMIT');
    res.status(201).json({ bet: betRows[0], balance: updatedUser[0].balance });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// GET /api/bets — последние ставки пользователя для вкладки "Мои ставки"
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.selection, b.amount, b.odds_at_bet, b.status, b.payout, b.created_at,
            m.home_team, m.away_team, m.commence_time, l.name AS league_name
       FROM bets b
       JOIN matches m ON m.id = b.match_id
       JOIN leagues l ON l.id = b.league_id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC
      LIMIT 200`,
    [req.userId]
  );
  res.json({ bets: rows });
}));

export default router;
