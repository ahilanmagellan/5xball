import { Router } from 'express';
import { pool } from '../db/pool.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const CLICK_COOLDOWN_MS = 1_000;
const CLICK_REWARD = 1;

const AD_COOLDOWN_MS = 30_000;
const AD_REWARD = 50;

/**
 * Общая механика антифрод-кулдауна: единственный источник правды — время
 * на сервере (last_click_at / last_ad_watch_at в БД). Кнопка на фронте
 * блокируется только для UX, а реальная защита от "зажать скриптом"
 * обеспечивается тут: любой запрос раньше cooldownMs просто отклоняется.
 */
async function claimReward({ userId, column, cooldownMs, reward }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT balance, ${column} AS last_at FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    const { balance, last_at } = rows[0];
    const now = Date.now();

    if (last_at) {
      const elapsed = now - new Date(last_at).getTime();
      if (elapsed < cooldownMs) {
        await client.query('ROLLBACK');
        const retryAfterMs = cooldownMs - elapsed;
        throw new HttpError(429, `Подождите ещё ${Math.ceil(retryAfterMs / 1000)} сек.`);
      }
    }

    const { rows: updated } = await client.query(
      `UPDATE users SET balance = balance + $1, ${column} = now() WHERE id = $2
       RETURNING balance, ${column} AS last_at`,
      [reward, userId]
    );
    await client.query('COMMIT');
    return {
      balance: updated[0].balance,
      nextAvailableAt: new Date(new Date(updated[0].last_at).getTime() + cooldownMs).toISOString(),
    };
  } catch (err) {
    if (err.status !== 429) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// POST /api/earn/click — кликер "+1 рубль"
router.post('/click', asyncHandler(async (req, res) => {
  const result = await claimReward({
    userId: req.userId,
    column: 'last_click_at',
    cooldownMs: CLICK_COOLDOWN_MS,
    reward: CLICK_REWARD,
  });
  res.json({ ...result, reward: CLICK_REWARD });
}));

// POST /api/earn/ad — заглушка "просмотр рекламы" (+50 руб.)
router.post('/ad', asyncHandler(async (req, res) => {
  const result = await claimReward({
    userId: req.userId,
    column: 'last_ad_watch_at',
    cooldownMs: AD_COOLDOWN_MS,
    reward: AD_REWARD,
  });
  res.json({ ...result, reward: AD_REWARD });
}));

// GET /api/earn/status — таймеры кулдаунов при открытии вкладки/перезагрузке страницы
router.get('/status', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT last_click_at, last_ad_watch_at FROM users WHERE id = $1',
    [req.userId]
  );
  const { last_click_at, last_ad_watch_at } = rows[0];
  const nextAt = (lastAt, cooldownMs) => (lastAt ? new Date(new Date(lastAt).getTime() + cooldownMs).toISOString() : null);

  res.json({
    click: { nextAvailableAt: nextAt(last_click_at, CLICK_COOLDOWN_MS), reward: CLICK_REWARD },
    ad: { nextAvailableAt: nextAt(last_ad_watch_at, AD_COOLDOWN_MS), reward: AD_REWARD },
  });
}));

export default router;
