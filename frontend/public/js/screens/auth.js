import { api } from '../api.js';
import { toast } from '../utils.js';

/**
 * Управляет тремя состояниями экрана: 'login' | 'register' | 'nickname'.
 * Регистрация двухшаговая: сначала email+пароль, и только после успешного
 * создания аккаунта (или при восстановлении сессии без ника) показываем
 * отдельный экран выбора никнейма — раньше в основное приложение не пускаем.
 */
export function renderAuthScreen(root, onLoggedIn, { forceNickname = false } = {}) {
  let mode = forceNickname ? 'nickname' : 'login';

  function render() {
    if (mode === 'nickname') return renderNicknameStep();

    root.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">⚽💸</div>
        <h1 class="auth-title">Симулятор Букмекера</h1>
        <p class="auth-subtitle">Виртуальные деньги. Реальная статистика. Никакого риска.</p>

        <div class="auth-tabs">
          <button class="auth-tab ${mode === 'login' ? 'active' : ''}" data-mode="login">Вход</button>
          <button class="auth-tab ${mode === 'register' ? 'active' : ''}" data-mode="register">Регистрация</button>
        </div>

        <form id="auth-form" class="auth-form" autocomplete="off">
          <label class="field-label">Email</label>
          <input class="field-input" id="auth-email" type="email" placeholder="you@example.com" required />

          <label class="field-label">Пароль</label>
          <input class="field-input" id="auth-password" type="password" placeholder="Минимум 6 символов" minlength="6" required />

          <button class="btn btn-primary btn-block" type="submit">
            ${mode === 'login' ? 'Войти' : 'Далее'}
          </button>
        </form>

        ${mode === 'register' ? '<p class="auth-hint">🎁 После регистрации вы получите 1000 виртуальных ₽ и придумаете никнейм</p>' : ''}
      </div>
    `;

    root.querySelectorAll('.auth-tab').forEach((btn) => {
      btn.onclick = () => { mode = btn.dataset.mode; render(); };
    });

    root.querySelector('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const email = root.querySelector('#auth-email').value.trim();
      const password = root.querySelector('#auth-password').value;
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const ref = sessionStorage.getItem('referral_code') || undefined;
        const { user } = mode === 'login' ? await api.login(email, password) : await api.register(email, password, ref);
        if (!user.username) {
          mode = 'nickname';
          render();
        } else {
          toast(`С возвращением, ${user.username}!`, 'success');
          onLoggedIn(user);
        }
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    };
  }

  function renderNicknameStep() {
    root.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">🎮</div>
        <h1 class="auth-title">Придумайте никнейм</h1>
        <p class="auth-subtitle">Финальный шаг — по нему вас будут находить друзья в игре</p>

        <form id="nickname-form" class="auth-form" autocomplete="off">
          <label class="field-label">Никнейм</label>
          <input class="field-input" id="nickname-input" type="text" placeholder="Например, striker_99" maxlength="20" required />
          <button class="btn btn-primary btn-block" type="submit">Готово</button>
        </form>
      </div>
    `;

    root.querySelector('#nickname-form').onsubmit = async (e) => {
      e.preventDefault();
      const username = root.querySelector('#nickname-input').value.trim();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const { user } = await api.setUsername(username);
        sessionStorage.removeItem('referral_code');
        toast(`Добро пожаловать, ${user.username}!`, 'success');
        onLoggedIn(user);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    };
  }

  render();
}
