import { api } from '../api.js';
import { avatarHtml, escapeHtml, formatMoney, toast } from '../utils.js';
import { openModal } from '../modal.js';

const TAB_LABEL = { friends: 'Друзья', incoming: 'Входящие', outgoing: 'Исходящие' };
const EMPTY_TEXT = {
  friends: 'Пока нет друзей. Найдите их по нику выше!',
  incoming: 'Нет входящих заявок',
  outgoing: 'Нет исходящих заявок',
};

export function renderFriendsScreen(root) {
  let tab = 'friends';
  let overview = { friends: [], incoming: [], outgoing: [] };

  root.innerHTML = `
    <div class="section-title">Друзья</div>
    <div class="search-bar">
      <input class="field-input" id="friend-search" placeholder="Никнейм друга..." />
      <button class="btn btn-primary btn-sm" id="friend-search-btn">Найти</button>
    </div>
    <div id="search-results"></div>

    <div class="tabs-strip">
      ${Object.keys(TAB_LABEL).map((t) => `<button class="btn btn-sm ${t === tab ? 'btn-primary' : 'btn-secondary'}" data-tab="${t}">${TAB_LABEL[t]}</button>`).join('')}
    </div>
    <div id="friends-list" class="card"><div class="empty-state">Загрузка...</div></div>
  `;

  root.querySelectorAll('.tabs-strip button').forEach((btn) => {
    btn.onclick = () => {
      tab = btn.dataset.tab;
      root.querySelectorAll('.tabs-strip button').forEach((b) => {
        b.classList.toggle('btn-primary', b.dataset.tab === tab);
        b.classList.toggle('btn-secondary', b.dataset.tab !== tab);
      });
      renderList();
    };
  });

  root.querySelector('#friend-search-btn').onclick = doSearch;
  root.querySelector('#friend-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  loadOverview();

  async function loadOverview() {
    try {
      overview = await api.friendsOverview();
      renderList();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderList() {
    const listEl = root.querySelector('#friends-list');
    const items = overview[tab];
    if (!items.length) {
      listEl.innerHTML = `<div class="empty-state">${EMPTY_TEXT[tab]}</div>`;
      return;
    }
    listEl.innerHTML = items.map((item) => renderRow(item, tab)).join('');

    if (tab === 'friends') {
      listEl.querySelectorAll('.friend-item').forEach((row) => {
        row.onclick = () => openFriendProfile(row.dataset.userId);
      });
    }
    if (tab === 'incoming') {
      listEl.querySelectorAll('[data-action="accept"]').forEach((btn) => btn.onclick = (e) => { e.stopPropagation(); respond(btn.dataset.id, 'accept'); });
      listEl.querySelectorAll('[data-action="decline"]').forEach((btn) => btn.onclick = (e) => { e.stopPropagation(); respond(btn.dataset.id, 'decline'); });
    }
    if (tab === 'outgoing') {
      listEl.querySelectorAll('[data-action="cancel"]').forEach((btn) => btn.onclick = (e) => { e.stopPropagation(); cancelRequest(btn.dataset.id); });
    }
  }

  async function respond(requestId, action) {
    try {
      await api.friendRespond(Number(requestId), action);
      toast(action === 'accept' ? 'Заявка принята' : 'Заявка отклонена', 'success');
      loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function cancelRequest(requestId) {
    try {
      await api.friendCancel(Number(requestId));
      loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function doSearch() {
    const q = root.querySelector('#friend-search').value.trim();
    const resultsEl = root.querySelector('#search-results');
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    try {
      const { users } = await api.friendsSearch(q);
      resultsEl.innerHTML = users.length
        ? `<div class="card">${users.map(renderSearchRow).join('')}</div>`
        : '<div class="empty-state">Никого не найдено</div>';
      resultsEl.querySelectorAll('[data-action="add"]').forEach((btn) => {
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            await api.friendRequest(btn.dataset.username);
            toast('Заявка отправлена!', 'success');
            doSearch();
            loadOverview();
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        };
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function openFriendProfile(userId) {
    try {
      const { user, stats } = await api.friendProfile(userId);
      openModal(`
        <button class="modal-close" id="modal-close-btn">✕</button>
        <div style="text-align:center">
          <div>${avatarHtml(user, 56)}</div>
          <div class="modal-title">${escapeHtml(user.username)}</div>
          <div class="topbar-balance" style="display:inline-flex;margin-bottom:14px">💰 ${formatMoney(user.balance)} ₽</div>
        </div>
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-title">Ставок сделано</div><div class="stat-big">${stats.totalBets}</div></div>
          <div class="stat-card"><div class="stat-title">Win rate</div><div class="stat-big">${stats.winRate.toFixed(1)}%</div></div>
          <div class="stat-card"><div class="stat-title">ROI</div><div class="stat-big ${stats.roi >= 0 ? 'positive' : 'negative'}">${stats.roi.toFixed(1)}%</div></div>
          <div class="stat-card"><div class="stat-title">Чистая прибыль</div><div class="stat-big ${stats.netProfit >= 0 ? 'positive' : 'negative'}">${formatMoney(stats.netProfit)} ₽</div></div>
        </div>
      `, { center: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

function renderRow(item, tab) {
  let actions = '';
  if (tab === 'incoming') {
    actions = `<div class="friend-actions">
      <button class="btn btn-primary btn-sm" data-action="accept" data-id="${item.request_id}">✓</button>
      <button class="btn btn-danger btn-sm" data-action="decline" data-id="${item.request_id}">✕</button>
    </div>`;
  } else if (tab === 'outgoing') {
    actions = `<div class="friend-actions"><button class="btn btn-danger btn-sm" data-action="cancel" data-id="${item.request_id}">Отменить</button></div>`;
  }
  return `
    <div class="friend-item ${tab === 'friends' ? 'friend-clickable' : ''}" data-user-id="${item.id}">
      <div class="friend-avatar">${avatarHtml(item, 26)}</div>
      <div class="friend-name">${escapeHtml(item.username)}</div>
      ${actions}
    </div>
  `;
}

function renderSearchRow(u) {
  let action;
  if (u.relation === 'none') action = `<button class="btn btn-primary btn-sm" data-action="add" data-username="${escapeHtml(u.username)}">Добавить</button>`;
  else if (u.relation === 'pending_outgoing') action = `<span class="badge badge-pending">Заявка отправлена</span>`;
  else if (u.relation === 'pending_incoming') action = `<span class="badge badge-pending">Ждёт вашего ответа</span>`;
  else action = `<span class="badge badge-won">Уже друзья</span>`;

  return `
    <div class="friend-item">
      <div class="friend-avatar">${avatarHtml(u, 26)}</div>
      <div class="friend-name">${escapeHtml(u.username)}</div>
      ${action}
    </div>
  `;
}
