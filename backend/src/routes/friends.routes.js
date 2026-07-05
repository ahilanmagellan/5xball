import { Router } from 'express';
import { pool } from '../db/pool.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserStats } from '../utils/statsQuery.js';

const router = Router();
router.use(requireAuth);

// GET /api/friends — три списка: друзья / входящие заявки / исходящие заявки
router.get('/', asyncHandler(async (req, res) => {
  const me = req.userId;

  const { rows: friends } = await pool.query(
    `SELECT u.id, u.username, u.avatar_id, u.avatar_url
       FROM friend_requests fr
       JOIN users u ON u.id = CASE WHEN fr.sender_id = $1 THEN fr.receiver_id ELSE fr.sender_id END
      WHERE fr.status = 'accepted' AND (fr.sender_id = $1 OR fr.receiver_id = $1)
      ORDER BY u.username`,
    [me]
  );

  const { rows: incoming } = await pool.query(
    `SELECT fr.id AS request_id, u.id, u.username, u.avatar_id, u.avatar_url, fr.created_at
       FROM friend_requests fr JOIN users u ON u.id = fr.sender_id
      WHERE fr.receiver_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC`,
    [me]
  );

  const { rows: outgoing } = await pool.query(
    `SELECT fr.id AS request_id, u.id, u.username, u.avatar_id, u.avatar_url, fr.created_at
       FROM friend_requests fr JOIN users u ON u.id = fr.receiver_id
      WHERE fr.sender_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC`,
    [me]
  );

  res.json({ friends, incoming, outgoing });
}));

// GET /api/friends/search?q=nick — поиск пользователей по нику
router.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ users: [] });

  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.avatar_id, u.avatar_url,
            fr.status AS relation_status,
            fr.sender_id AS relation_sender_id
       FROM users u
       LEFT JOIN friend_requests fr
              ON (fr.sender_id = u.id AND fr.receiver_id = $1)
              OR (fr.receiver_id = u.id AND fr.sender_id = $1)
      WHERE u.username ILIKE $2 AND u.id <> $1
      ORDER BY u.username
      LIMIT 20`,
    [req.userId, `%${q}%`]
  );

  res.json({
    users: rows.map((u) => ({
      id: u.id,
      username: u.username,
      avatar_id: u.avatar_id,
      avatar_url: u.avatar_url,
      // relation: none | pending_outgoing | pending_incoming | accepted
      relation: !u.relation_status
        ? 'none'
        : u.relation_status === 'accepted'
        ? 'accepted'
        : u.relation_status === 'pending'
        ? (u.relation_sender_id === req.userId ? 'pending_outgoing' : 'pending_incoming')
        : 'none',
    })),
  });
}));

// POST /api/friends/request { username }
router.post('/request', asyncHandler(async (req, res) => {
  const { username } = req.body || {};
  if (!username) throw new HttpError(400, 'Укажите никнейм');

  const { rows: targetRows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  const target = targetRows[0];
  if (!target) throw new HttpError(404, 'Пользователь не найден');
  if (target.id === req.userId) throw new HttpError(400, 'Нельзя добавить в друзья самого себя');

  const { rows: existingRows } = await pool.query(
    `SELECT * FROM friend_requests
      WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)`,
    [req.userId, target.id]
  );
  const existing = existingRows.find((r) => r.status !== 'declined');
  if (existing) {
    throw new HttpError(409, existing.status === 'accepted' ? 'Вы уже друзья' : 'Заявка уже отправлена');
  }

  const { rows } = await pool.query(
    `INSERT INTO friend_requests (sender_id, receiver_id, status)
     VALUES ($1, $2, 'pending')
     ON CONFLICT (sender_id, receiver_id) DO UPDATE SET status = 'pending', responded_at = NULL, created_at = now()
     RETURNING id`,
    [req.userId, target.id]
  );
  res.status(201).json({ requestId: rows[0].id });
}));

// POST /api/friends/respond { request_id, action: 'accept' | 'decline' }
router.post('/respond', asyncHandler(async (req, res) => {
  const { request_id, action } = req.body || {};
  if (!['accept', 'decline'].includes(action)) throw new HttpError(400, 'Некорректное действие');

  const newStatus = action === 'accept' ? 'accepted' : 'declined';
  const { rows } = await pool.query(
    `UPDATE friend_requests SET status = $1, responded_at = now()
      WHERE id = $2 AND receiver_id = $3 AND status = 'pending'
      RETURNING id`,
    [newStatus, request_id, req.userId]
  );
  if (!rows.length) throw new HttpError(404, 'Заявка не найдена');
  res.json({ ok: true });
}));

// POST /api/friends/cancel { request_id } — отменить свою исходящую заявку
router.post('/cancel', asyncHandler(async (req, res) => {
  const { request_id } = req.body || {};
  const { rows } = await pool.query(
    `DELETE FROM friend_requests WHERE id = $1 AND sender_id = $2 AND status = 'pending' RETURNING id`,
    [request_id, req.userId]
  );
  if (!rows.length) throw new HttpError(404, 'Заявка не найдена');
  res.json({ ok: true });
}));

// GET /api/friends/:userId/profile — игровой профиль друга (баланс + статистика)
router.get('/:userId/profile', asyncHandler(async (req, res) => {
  const friendId = Number(req.params.userId);

  const { rows: relRows } = await pool.query(
    `SELECT 1 FROM friend_requests
      WHERE status = 'accepted' AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`,
    [req.userId, friendId]
  );
  if (!relRows.length) throw new HttpError(403, 'Профиль доступен только друзьям');

  const { rows: userRows } = await pool.query(
    'SELECT id, username, balance, avatar_id, avatar_url, created_at FROM users WHERE id = $1',
    [friendId]
  );
  if (!userRows.length) throw new HttpError(404, 'Пользователь не найден');

  const stats = await getUserStats(friendId);
  res.json({ user: userRows[0], stats });
}));

export default router;
