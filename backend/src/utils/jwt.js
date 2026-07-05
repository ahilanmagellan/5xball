import jwt from 'jsonwebtoken';

const TTL_DAYS = Number(process.env.JWT_TTL_DAYS || 30);

export function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: `${TTL_DAYS}d` });
}

export function verifyToken(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  return payload.sub; // userId
}

export const COOKIE_MAX_AGE_MS = TTL_DAYS * 24 * 60 * 60 * 1000;
