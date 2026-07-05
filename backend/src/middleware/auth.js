import { verifyToken } from '../utils/jwt.js';

/**
 * Достаёт JWT из httpOnly-cookie "token", проверяет подпись и кладёт
 * req.userId. Cookie httpOnly недоступна из JS в браузере — это защита
 * от кражи токена через XSS (в отличие от хранения JWT в localStorage).
 */
export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Не авторизован' });

  try {
    req.userId = verifyToken(token);
    next();
  } catch {
    res.clearCookie('token');
    return res.status(401).json({ error: 'Сессия истекла, войдите заново' });
  }
}
