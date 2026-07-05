import { api } from '../api.js';
import { escapeHtml, formatDateTime, formatMoney, toast } from '../utils.js';

const STATUS_LABEL = { pending: 'В игре', won: 'Выиграла', lost: 'Проиграла' };
const SELECTION_LABEL = { H: 'П1', D: 'Х', A: 'П2' };

export function renderBetsScreen(root) {
  root.innerHTML = `<div class="section-title">Мои ставки</div><div id="bets-list"><div class="empty-state">Загрузка...</div></div>`;
  load();

  async function load() {
    const listEl = root.querySelector('#bets-list');
    try {
      const { bets } = await api.myBets();
      listEl.innerHTML = bets.length
        ? `<div class="card">${bets.map(renderBetItem).join('')}</div>`
        : '<div class="empty-state">Вы ещё не делали ставок.<br>Загляните во вкладку «Матчи»!</div>';
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

function renderBetItem(b) {
  return `
    <div class="bet-item">
      <div class="bet-info">
        <div class="bet-teams">${escapeHtml(b.home_team)} — ${escapeHtml(b.away_team)}</div>
        <div class="bet-meta">${formatDateTime(b.created_at)} · ${SELECTION_LABEL[b.selection]} · кэф ${b.odds_at_bet}</div>
      </div>
      <div class="bet-right">
        <div class="bet-amount">${formatMoney(b.amount)} ₽</div>
        <span class="badge badge-${b.status}">${STATUS_LABEL[b.status]}</span>
      </div>
    </div>
  `;
}
