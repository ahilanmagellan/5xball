import { api } from '../api.js';
import { escapeHtml, formatDateTime, formatMoney, teamBadgeHtml, toast } from '../utils.js';
import { openModal, closeModal } from '../modal.js';
import { app, setBalance } from '../main.js';

const SELECTION_LABEL = { H: 'П1', D: 'Х', A: 'П2' };

export function renderMatchesScreen(root) {
  let leagues = [];
  let activeKey = null;

  root.innerHTML = `
    <div id="league-tabs" class="league-tabs"></div>
    <div id="league-stats" class="league-stats"></div>
    <div id="round-label" class="round-label"></div>
    <div id="matches-list"></div>
  `;

  init();

  async function init() {
    try {
      const { leagues: ls } = await api.leagues();
      leagues = ls;
      if (!leagues.length) {
        root.querySelector('#matches-list').innerHTML =
          '<div class="empty-state">Лиги ещё не загружены.<br>Выполните `npm run seed` на бэкенде.</div>';
        return;
      }
      activeKey = leagues[0].key;
      renderTabs();
      await loadLeague(activeKey);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderTabs() {
    const tabsEl = root.querySelector('#league-tabs');
    tabsEl.innerHTML = leagues
      .map((l) => {
        const badge = l.logo_url
          ? `<img src="${escapeHtml(l.logo_url)}" alt="" class="league-tab-badge" data-fallback="🏆" onerror="this.style.display='none'" />`
          : '';
        return `<button class="league-tab ${l.key === activeKey ? 'active' : ''}" data-key="${l.key}">${badge}${escapeHtml(l.name)}</button>`;
      })
      .join('');
    tabsEl.querySelectorAll('.league-tab').forEach((btn) => {
      btn.onclick = () => {
        activeKey = btn.dataset.key;
        renderTabs();
        loadLeague(activeKey);
      };
    });
  }

  async function loadLeague(key) {
    const statsEl = root.querySelector('#league-stats');
    const roundEl = root.querySelector('#round-label');
    const listEl = root.querySelector('#matches-list');
    listEl.innerHTML = '<div class="empty-state">Загрузка...</div>';
    roundEl.textContent = '';

    try {
      const [{ stats }, { matches }] = await Promise.all([api.leagueStats(key), api.leagueMatches(key)]);
      statsEl.innerHTML = renderStatsHeader(stats);
      const round = matches[0]?.round_number;
      roundEl.textContent = matches.length
        ? (round && round <= 50 ? `⚡ Ближайший тур — тур ${round}. Ставки принимаются только на эти матчи.` : '⚡ Матчи ближайшего тура. Ставки принимаются только на них.')
        : '';
      listEl.innerHTML = matches.length
        ? matches.map(renderMatchCard).join('')
        : '<div class="empty-state">На ближайшее время матчей нет</div>';

      listEl.querySelectorAll('.match-card').forEach((card) => {
        const match = matches.find((m) => String(m.id) === card.dataset.matchId);
        card.querySelectorAll('.odds-btn').forEach((btn) => {
          btn.onclick = () => openBetModal(match, btn.dataset.selection, () => loadLeague(key));
        });
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

function renderStatsHeader(stats) {
  return `
    <div class="stat-box staked">
      <div class="stat-label">Поставлено</div>
      <div class="stat-value">${formatMoney(stats.staked)} ₽</div>
    </div>
    <div class="stat-box won">
      <div class="stat-label">Выиграно</div>
      <div class="stat-value">${formatMoney(stats.won)} ₽</div>
    </div>
    <div class="stat-box lost">
      <div class="stat-label">Проиграно</div>
      <div class="stat-value">${formatMoney(stats.lost)} ₽</div>
    </div>
  `;
}

function renderMatchCard(m) {
  return `
    <div class="card match-card" data-match-id="${m.id}">
      <div class="match-teams">
        <span class="team-name-wrap">${teamBadgeHtml(m.home_team, m.home_logo)}${escapeHtml(m.home_team)}</span>
        <span class="match-vs">vs</span>
        <span class="team-name-wrap team-name-wrap--reverse">${escapeHtml(m.away_team)}${teamBadgeHtml(m.away_team, m.away_logo)}</span>
      </div>
      <div class="match-time ${m.is_frozen ? 'frozen' : ''}">
        ${formatDateTime(m.commence_time)}${m.is_frozen ? ' · 🔒 кэф заморожен' : ''}
      </div>
      <div class="odds-row">
        <button class="odds-btn" data-selection="H"><span class="odds-label">П1</span><span class="odds-value">${m.odds_home}</span></button>
        <button class="odds-btn" data-selection="D"><span class="odds-label">Х</span><span class="odds-value">${m.odds_draw}</span></button>
        <button class="odds-btn" data-selection="A"><span class="odds-label">П2</span><span class="odds-value">${m.odds_away}</span></button>
      </div>
    </div>
  `;
}

function openBetModal(match, selection, onSettled) {
  const oddsMap = { H: match.odds_home, D: match.odds_draw, A: match.odds_away };
  const odds = Number(oddsMap[selection]);

  const card = openModal(`
    <button class="modal-close" id="modal-close-btn">✕</button>
    <div class="modal-title">
      ${teamBadgeHtml(match.home_team, match.home_logo, 22)} ${escapeHtml(match.home_team)} — ${escapeHtml(match.away_team)} ${teamBadgeHtml(match.away_team, match.away_logo, 22)}
    </div>
    <div style="text-align:center;color:var(--text-dim);font-size:13px;">
      Ваш выбор: <b style="color:var(--text)">${SELECTION_LABEL[selection]}</b> · коэффициент ${odds}
    </div>
    <input type="number" id="bet-amount" class="bet-amount-input" placeholder="Сумма ставки" min="1" step="1" />
    <div class="quick-amounts">
      <button class="btn btn-secondary btn-sm" data-amt="50">+50</button>
      <button class="btn btn-secondary btn-sm" data-amt="100">+100</button>
      <button class="btn btn-secondary btn-sm" data-amt="500">+500</button>
      <button class="btn btn-secondary btn-sm" data-amt="max">Всё (${formatMoney(app.user.balance)})</button>
    </div>
    <div class="bet-potential">Возможный выигрыш: <b id="bet-potential-value">0 ₽</b></div>
    <button class="btn btn-primary btn-block" id="confirm-bet-btn">Поставить</button>
  `);

  const amountInput = card.querySelector('#bet-amount');
  const potentialEl = card.querySelector('#bet-potential-value');

  const updatePotential = () => {
    const amt = Number(amountInput.value) || 0;
    potentialEl.textContent = `${formatMoney(amt * odds)} ₽`;
  };
  amountInput.oninput = updatePotential;

  card.querySelectorAll('.quick-amounts button').forEach((btn) => {
    btn.onclick = () => {
      amountInput.value = btn.dataset.amt === 'max' ? app.user.balance : Number(amountInput.value || 0) + Number(btn.dataset.amt);
      updatePotential();
    };
  });

  card.querySelector('#confirm-bet-btn').onclick = async () => {
    const amount = Number(amountInput.value);
    if (!amount || amount <= 0) { toast('Введите сумму ставки', 'error'); return; }

    const confirmBtn = card.querySelector('#confirm-bet-btn');
    confirmBtn.disabled = true;
    try {
      const { balance } = await api.placeBet(match.id, selection, amount);
      setBalance(balance);
      toast('Ставка принята!', 'success');
      closeModal();
      onSettled?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      confirmBtn.disabled = false;
    }
  };
}
