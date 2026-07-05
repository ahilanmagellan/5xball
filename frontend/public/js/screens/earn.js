import { api } from '../api.js';
import { countdown, formatMoney, toast } from '../utils.js';
import { setBalance } from '../main.js';

export function renderEarnScreen(root) {
  root.innerHTML = `
    <div class="section-title">Заработок</div>

    <div class="card earn-card">
      <div class="earn-icon">📺</div>
      <div class="earn-desc">Посмотрите рекламу и получите бонус на баланс</div>
      <button class="btn btn-primary btn-block" id="ad-btn">Посмотреть видео (+50 ₽)</button>
      <div class="cooldown-text" id="ad-cooldown"></div>
    </div>

    <div class="card earn-card">
      <div class="earn-desc">Жмите на кнопку — небольшой доход каждую секунду</div>
      <button class="clicker-btn" id="click-btn">+1 ₽</button>
      <div class="cooldown-text" id="click-cooldown"></div>
    </div>

    <div class="section-title">Пригласить друзей</div>
    <div class="card">
      <div class="earn-desc">
        Поделитесь ссылкой — как только друг зарегистрируется и придумает никнейм,
        вы получите <b style="color:var(--gold)">10 000 ₽</b>
      </div>
      <div class="referral-row">
        <input class="field-input" id="referral-link" readonly />
        <button class="btn btn-secondary btn-sm" id="copy-referral-btn">Копировать</button>
      </div>
      <div class="referral-stats">
        <div class="referral-stat"><span id="referral-count">0</span><small>друзей привели</small></div>
        <div class="referral-stat"><span id="referral-earned">0 ₽</span><small>заработано</small></div>
      </div>
    </div>
  `;

  const adBtn = root.querySelector('#ad-btn');
  const clickBtn = root.querySelector('#click-btn');
  const adCooldownEl = root.querySelector('#ad-cooldown');
  const clickCooldownEl = root.querySelector('#click-cooldown');

  init();
  loadReferrals();

  async function init() {
    try {
      const status = await api.earnStatus();
      armCooldown(adBtn, adCooldownEl, status.ad.nextAvailableAt);
      armCooldown(clickBtn, clickCooldownEl, status.click.nextAvailableAt);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadReferrals() {
    try {
      const { code, referredCount, totalEarned } = await api.referrals();
      const link = `${window.location.origin}/?ref=${code}`;
      root.querySelector('#referral-link').value = link;
      root.querySelector('#referral-count').textContent = referredCount;
      root.querySelector('#referral-earned').textContent = `${formatMoney(totalEarned)} ₽`;

      root.querySelector('#copy-referral-btn').onclick = async () => {
        try {
          await navigator.clipboard.writeText(link);
          toast('Ссылка скопирована', 'success');
        } catch {
          root.querySelector('#referral-link').select();
          toast('Скопируйте ссылку вручную (Ctrl+C)', 'info');
        }
      };
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Кнопка "поставить на паузу до nextAt" + текстовый таймер обратного отсчёта.
  // Реальная защита от накрутки — на сервере (last_click_at/last_ad_watch_at),
  // это лишь синхронизация UI с тем, что уже верно с точки зрения бэкенда.
  function armCooldown(btn, textEl, nextAt) {
    const tick = () => {
      if (!root.isConnected) return clearInterval(timer); // экран уже сменили — останавливаем таймер
      const left = countdown(nextAt);
      if (!left) {
        btn.disabled = false;
        textEl.textContent = '';
        clearInterval(timer);
      } else {
        btn.disabled = true;
        textEl.textContent = `Доступно через ${left}`;
      }
    };
    const timer = setInterval(tick, 250);
    tick();
  }

  adBtn.onclick = async () => {
    adBtn.disabled = true;
    adBtn.textContent = 'Идёт просмотр...';
    // Заглушка "просмотра рекламы" — в реальном проекте здесь интеграция с рекламным SDK
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const result = await api.earnAd();
      setBalance(result.balance);
      toast(`+${result.reward} ₽ за просмотр!`, 'success');
      armCooldown(adBtn, adCooldownEl, result.nextAvailableAt);
    } catch (err) {
      toast(err.message, 'error');
      adBtn.disabled = false;
    } finally {
      adBtn.textContent = 'Посмотреть видео (+50 ₽)';
    }
  };

  clickBtn.onclick = async () => {
    clickBtn.disabled = true;
    try {
      const result = await api.earnClick();
      setBalance(result.balance);
      armCooldown(clickBtn, clickCooldownEl, result.nextAvailableAt);
    } catch (err) {
      toast(err.message, 'error');
      clickBtn.disabled = false;
    }
  };
}
