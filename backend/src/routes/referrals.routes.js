import { Router } from 'express';
import { pool } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { REFERRAL_REWARD } from '../utils/referral.js';

const router = Router();
router.use(requireAuth);

// GET /api/referrals — свой код + сколько друзей реально зарегистрировалось по нему
router.get('/', asyncHandler(async (req, res) => {
  const { rows: userRows } = await pool.query('SELECT referral_code FROM users WHERE id = $1', [req.userId]);

  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int AS c FROM users WHERE referred_by = $1 AND referral_rewarded = true`,
    [req.userId]
  );
  const referredCount = countRows[0].c;

  res.json({
    code: userRows[0].referral_code,
    referredCount,
    totalEarned: referredCount * REFERRAL_REWARD,
    rewardPerFriend: REFERRAL_REWARD,
  });
}));

export default router;
