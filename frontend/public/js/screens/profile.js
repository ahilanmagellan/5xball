import { api } from '../api.js';
import { avatarHtml, escapeHtml, formatMoney, toast } from '../utils.js';
import { app, updateTopbar, logout } from '../main.js';

const MAX_AVATAR_SIZE = 3 * 1024 * 1024;

export function renderProfileScreen(root) {
  root.innerHTML = `
    <div class="section-title">Профиль</div>
    <div class="card" style="text-align:center;margin-bottom:16px">
      <div class="profile-avatar-big">${avatarHtml(app.user, 72)}</div>
      <div style="font-weight:700;font-size:16px;margin-top:10px">${escapeHtml(app.user.username)}</div>
      <div style="color:var(--text-dim);font-size:12px;margin-top:2px">
        В игре с ${new Date(app.user.created_at).toLocaleDateString('ru-RU')}
      </div>
      <button class="btn btn-secondary btn-sm" id="upload-avatar-btn" style="margin-top:14px">📷 Загрузить фото из медиатеки</button>
      <input type="file" id="avatar-file-input" accept="image/*" class="hidden" />
    </div>

    <div class="section-title">Статистика</div>
    <div id="stats-container"><div class="empty-state">Загрузка...</div></div>

    <button class="btn btn-danger btn-block" id="logout-btn" style="margin-top:20px">Выйти из аккаунта</button>
  `;

  const bigAvatarEl = root.querySelector('.profile-avatar-big');

  const fileInput = root.querySelector('#avatar-file-input');
  root.querySelector('#upload-avatar-btn').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = ''; // чтобы повторный выбор того же файла тоже сработал
    if (!file) return;
    if (file.size > MAX_AVATAR_SIZE) {
      toast('Файл слишком большой (максимум 3 МБ)', 'error');
      return;
    }
    try {
      const { avatarUrl } = await api.uploadAvatar(file);
      app.user.avatar_url = avatarUrl;
      updateTopbar();
      bigAvatarEl.innerHTML = avatarHtml(app.user, 72);
      toast('Фото загружено', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  root.querySelector('#logout-btn').onclick = logout;

  loadStats();

  async function loadStats() {
    try {
      const { stats } = await api.profileStats();
      root.querySelector('#stats-container').innerHTML = renderStats(stats);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

function renderStats(s) {
  return `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-title">Всего ставок</div><div class="stat-big">${s.totalBets}</div></div>
      <div class="stat-card"><div class="stat-title">Угадано верно</div><div class="stat-big">${s.wonBets} (${s.winRate.toFixed(1)}%)</div></div>
      <div class="stat-card"><div class="stat-title">Поставлено всего</div><div class="stat-big">${formatMoney(s.totalStaked)} ₽</div></div>
      <div class="stat-card"><div class="stat-title">Чистая прибыль</div><div class="stat-big ${s.netProfit >= 0 ? 'positive' : 'negative'}">${formatMoney(s.netProfit)} ₽</div></div>
      <div class="stat-card" style="grid-column:1/-1">
        <div class="stat-title">ROI (доходность ставок)</div>
        <div class="stat-big ${s.roi >= 0 ? 'positive' : 'negative'}" style="font-size:28px">${s.roi.toFixed(1)}%</div>
      </div>
    </div>
    <div class="roi-callout">
      📉 ROI показывает, сколько в среднем вы получаете (или теряете) с каждого поставленного рубля.
      Коэффициенты букмекеров всегда содержат встроенную маржу, поэтому на длинной дистанции этот
      показатель у подавляющего большинства игроков уходит в минус — систематически обыграть
      букмекера математически невозможно.
    </div>
  `;
}
