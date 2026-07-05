import { api } from './api.js';
import { avatarHtml, formatMoney, toast } from './utils.js';
import { renderAuthScreen } from './screens/auth.js';
import { renderMatchesScreen } from './screens/matches.js';
import { renderBetsScreen } from './screens/bets.js';
import { renderEarnScreen } from './screens/earn.js';
import { renderFriendsScreen } from './screens/friends.js';
import { renderProfileScreen } from './screens/profile.js';

// Простое общее состояние приложения — без фреймворков, MVP не нуждается в Redux/React.
export const app = {
  user: null,
};

const SCREENS = {
  matches: renderMatchesScreen,
  bets: renderBetsScreen,
  earn: renderEarnScreen,
  friends: renderFriendsScreen,
  profile: renderProfileScreen,
};

const authScreenEl = document.getElementById('auth-screen');
const appEl = document.getElementById('app');
const screenRoot = document.getElementById('screen-root');

async function boot() {
  try {
    const { user } = await api.me();
    app.user = user;
    // Регистрация двухшаговая: если сессия восстановилась, а никнейм так и
    // не был придуман (например, вкладку закрыли между шагами) — сначала
    // дожимаем этот шаг и только потом пускаем в приложение.
    if (!user.username) {
      showNicknameGate();
    } else {
      showApp();
    }
  } catch {
    showAuth();
  }
}

function showAuth() {
  authScreenEl.classList.remove('hidden');
  appEl.classList.add('hidden');
  renderAuthScreen(authScreenEl, (user) => {
    app.user = user;
    showApp();
  });
}

function showNicknameGate() {
  authScreenEl.classList.remove('hidden');
  appEl.classList.add('hidden');
  renderAuthScreen(authScreenEl, (user) => {
    app.user = user;
    showApp();
  }, { forceNickname: true });
}

function showApp() {
  authScreenEl.classList.add('hidden');
  appEl.classList.remove('hidden');
  updateTopbar();
  wireBottomNav();
  navigateTo('matches');
}

function wireBottomNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.onclick = () => navigateTo(btn.dataset.screen);
  });
}

export function navigateTo(screen) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === screen));
  screenRoot.innerHTML = '';
  screenRoot.scrollTop = 0;
  SCREENS[screen](screenRoot);
}

export function updateTopbar() {
  document.getElementById('topbar-username').textContent = app.user.username;
  document.getElementById('topbar-balance').textContent = formatMoney(app.user.balance);
  document.getElementById('topbar-avatar').innerHTML = avatarHtml(app.user, 26);
}

export function setBalance(balance) {
  app.user.balance = Number(balance);
  updateTopbar();
}

export async function logout() {
  await api.logout().catch(() => {});
  app.user = null;
  toast('Вы вышли из аккаунта');
  showAuth();
}

// Делегированный обработчик битых картинок (аватар пользователя / логотип
// команды): "error" не всплывает, поэтому слушаем на capture-фазе один раз
// на весь документ вместо inline onerror на каждом <img>.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;

  if (img.classList.contains('avatar-img')) {
    const span = document.createElement('span');
    span.style.fontSize = img.style.width;
    span.style.lineHeight = '1';
    span.textContent = img.dataset.fallback || '⚽';
    img.replaceWith(span);
  } else if (img.classList.contains('team-badge')) {
    const span = document.createElement('span');
    span.className = 'team-badge-fallback';
    span.style.width = img.style.width;
    span.style.height = img.style.height;
    span.textContent = img.dataset.fallback || '?';
    img.replaceWith(span);
  }
}, true);

// Реферальная ссылка вида /?ref=CODE — код сохраняем на время сессии
// вкладки, чтобы он пережил возможный переход между вкладками "Вход/Регистрация"
// и был отправлен вместе с запросом регистрации (см. screens/auth.js).
(function captureReferralCode() {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) sessionStorage.setItem('referral_code', ref);
})();

boot();
