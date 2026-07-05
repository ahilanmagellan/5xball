import { Router } from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db/pool.js';
import { signToken, COOKIE_MAX_AGE_MS } from '../utils/jwt.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { generateReferralCode, REFERRAL_REWARD } from '../utils/referral.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const BCRYPT_ROUNDS = 12;

const PUBLIC_USER_FIELDS = 'id, email, username, balance, avatar_id, avatar_url, created_at';

function setAuthCookie(res, userId) {
  const token = signToken(userId);
  res.cookie('token', token, {
    httpOnly: true, // недоступна из document.cookie в браузере -> защита от XSS-кражи токена
    sameSite: 'lax', // защита от CSRF при межсайтовых POST
    secure: process.env.NODE_ENV === 'production', // только по HTTPS в проде
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

// POST /api/auth/register { email, password, ref? }
// Никнейм на этом шаге ещё не запрашивается — username в БД остаётся NULL,
// фронт после успешной регистрации обязан показать экран "придумайте ник"
// (см. /auth/set-username) прежде чем пускать в основное приложение.
// Необязательный `ref` — реферальный код пригласившего (из ссылки вида
// /?ref=CODE); награда пригласившему начисляется позже, на шаге set-username,
// когда регистрация считается "реально" завершённой.
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, ref } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw new HttpError(400, 'Введите корректный email');
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new HttpError(400, 'Пароль должен быть не короче 6 символов');
  }
  const normalizedEmail = email.trim().toLowerCase();

  const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.length > 0) {
    throw new HttpError(409, 'Пользователь с таким email уже зарегистрирован');
  }

  let referredBy = null;
  if (typeof ref === 'string' && ref.trim()) {
    const { rows: referrerRows } = await pool.query('SELECT id FROM users WHERE referral_code = $1', [ref.trim().toLowerCase()]);
    if (referrerRows[0]) referredBy = referrerRows[0].id;
  }

  // Пароль никогда не хранится в открытом виде — только bcrypt-хэш с солью.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // balance по умолчанию = 1000.00 берётся из DEFAULT в схеме users.balance.
  // referral_code генерируется тут же и уникальности добиваемся повторной
  // генерацией при коллизии (шанс коллизии на 40-битном коде исчезающе мал).
  let user;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, referral_code, referred_by)
         VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_USER_FIELDS}`,
        [normalizedEmail, passwordHash, generateReferralCode(), referredBy]
      );
      user = rows[0];
      break;
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'idx_users_referral_code' && attempt < 4) continue;
      throw err;
    }
  }

  setAuthCookie(res, user.id);
  res.status(201).json({ user }); // user.username === null здесь — это ожидаемо
}));

// POST /api/auth/set-username { username } — второй, обязательный шаг регистрации.
// Никнейм можно установить только один раз (пока он NULL) — это постоянный
// публичный идентификатор для поиска в друзьях. Именно на этом шаге
// пользователь считается "реально зарегистрированным" — если его привёл
// реферер, здесь ему начисляется награда.
router.post('/set-username', requireAuth, asyncHandler(async (req, res) => {
  const { username } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    throw new HttpError(400, 'Никнейм: 3-20 символов, латиница/цифры/подчёркивание');
  }

  const { rows: currentRows } = await pool.query('SELECT username FROM users WHERE id = $1', [req.userId]);
  if (currentRows[0]?.username) {
    throw new HttpError(409, 'Никнейм уже выбран и не может быть изменён');
  }

  const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.length > 0) {
    throw new HttpError(409, 'Такой никнейм уже занят');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE users SET username = $1 WHERE id = $2
       RETURNING ${PUBLIC_USER_FIELDS}, referred_by, referral_rewarded`,
      [username, req.userId]
    );
    const user = rows[0];

    if (user.referred_by && !user.referral_rewarded) {
      await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [REFERRAL_REWARD, user.referred_by]);
      await client.query('UPDATE users SET referral_rewarded = true WHERE id = $1', [req.userId]);
    }

    await client.query('COMMIT');
    delete user.referred_by;
    delete user.referral_rewarded;
    res.json({ user });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// POST /api/auth/login { email, password }
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new HttpError(400, 'Укажите email и пароль');
  }
  const normalizedEmail = email.trim().toLowerCase();

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  const user = rows[0];
  // Намеренно одинаковое сообщение и для "нет юзера", и для "неверный пароль",
  // чтобы не давать атакующему подтверждение существования email в системе.
  if (!user) throw new HttpError(401, 'Неверный email или пароль');

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new HttpError(401, 'Неверный email или пароль');

  setAuthCookie(res, user.id);
  delete user.password_hash;
  res.json({ user }); // user.username может быть null, если регистрацию не довели до конца в прошлый раз
}));

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me — кто я, используется фронтом при загрузке приложения
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = $1`, [req.userId]);
  if (!rows[0]) throw new HttpError(401, 'Пользователь не найден');
  res.json({ user: rows[0] });
}));

export default router;
