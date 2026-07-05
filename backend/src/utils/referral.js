import crypto from 'node:crypto';

// Сколько виртуальных рублей получает пригласивший, когда приглашённый
// реально завершает регистрацию (доходит до выбора никнейма).
export const REFERRAL_REWARD = 10000;

export function generateReferralCode() {
  return crypto.randomBytes(5).toString('hex'); // 10 hex-символов, напр. 'a3f9c1e08b'
}
