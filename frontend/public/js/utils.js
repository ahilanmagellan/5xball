// Эмодзи-заглушка, пока пользователь не загрузил свою фотографию из медиатеки.
const DEFAULT_AVATAR_EMOJI = '⚽';

export function formatMoney(value) {
  return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

export function toast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast--show'));
  setTimeout(() => {
    el.classList.remove('toast--show');
    setTimeout(() => el.remove(), 250);
  }, 2600);
}

/** Обратный отсчёт до ISO-таймстампа, формат "MM:SS". Возвращает null, если время уже прошло. */
export function countdown(targetIso) {
  if (!targetIso) return null;
  const diff = new Date(targetIso).getTime() - Date.now();
  if (diff <= 0) return null;
  const totalSec = Math.ceil(diff / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * HTML аватара пользователя: если загружена своя фотография (avatar_url) —
 * показываем её, иначе эмодзи-заглушку. Если картинка не загрузится (файл
 * удалили и т.п.), делегированный обработчик в main.js подменит <img> на
 * заглушку через data-fallback.
 */
export function avatarHtml(user, size = 28) {
  if (user?.avatar_url) {
    return `<img src="${escapeHtml(user.avatar_url)}" alt="" class="avatar-img" style="width:${size}px;height:${size}px;font-size:${size}px" data-fallback="${DEFAULT_AVATAR_EMOJI}" />`;
  }
  return `<span style="font-size:${size}px;line-height:1">${DEFAULT_AVATAR_EMOJI}</span>`;
}

/**
 * HTML эмблемы команды: картинка из TheSportsDB, а если её нет в кэше
 * (logoUrl === null) или она не загрузилась — кружок с инициалами команды.
 */
export function teamBadgeHtml(teamName, logoUrl, size = 24) {
  const initials = escapeHtml(
    teamName.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  );
  if (!logoUrl) {
    return `<span class="team-badge-fallback" style="width:${size}px;height:${size}px;font-size:${size * 0.42}px">${initials}</span>`;
  }
  return `<img src="${escapeHtml(logoUrl)}" alt="" class="team-badge" style="width:${size}px;height:${size}px" data-fallback="${initials}" />`;
}
