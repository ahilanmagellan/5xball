import { pool } from '../db/pool.js';

const USE_MOCK = String(process.env.USE_MOCK_ODDS).toLowerCase() !== 'false';
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Генерирует "рыночные" коэффициенты П1/Х/П2 с встроенной букмекерской
 * маржой (overround) 6-10%. Это ключевая механика проекта: сумма
 * 1/кэф всегда > 1, поэтому мат.ожидание ставки при любой стратегии
 * отрицательное — именно это на дистанции и должно "убить" баланс игрока.
 */
export function generateMockOdds() {
  const pHome = 0.38 + Math.random() * 0.14; // домашнее преимущество
  const pAway = (1 - pHome) * (0.35 + Math.random() * 0.3);
  const pDraw = 1 - pHome - pAway;
  const margin = 1.06 + Math.random() * 0.04; // маржа букмекера 106%-110%

  return {
    odds_home: round2(1 / (pHome * margin)),
    odds_draw: round2(1 / (pDraw * margin)),
    odds_away: round2(1 / (pAway * margin)),
  };
}

/** Небольшое "дыхание" рынка для уже созданных мок-матчей: коэффициенты
 * слегка колеблются в течение дня, как будто идут реальные торги. */
function jitterOdds(match) {
  const jitter = (v) => Math.max(1.01, round2(v * (1 + (Math.random() - 0.5) * 0.06)));
  return {
    odds_home: jitter(Number(match.odds_home)),
    odds_draw: jitter(Number(match.odds_draw)),
    odds_away: jitter(Number(match.odds_away)),
  };
}

/**
 * Достаёт из The Odds API реальные коэффициенты 1X2 (market h2h) для
 * заданного вида спорта и сохраняет их в matches (upsert по external_id).
 * Используется только если USE_MOCK_ODDS=false и задан ODDS_API_KEY.
 */
async function fetchRealOddsForLeague(league) {
  if (!ODDS_API_KEY) {
    console.warn(`[odds] ODDS_API_KEY не задан, пропускаю лигу ${league.key}`);
    return;
  }
  const url = `${ODDS_API_BASE}/sports/${league.api_sport_key}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[odds] The Odds API вернул ${res.status} для ${league.key}`);
    return;
  }
  const events = await res.json();

  for (const event of events) {
    const bookmaker = event.bookmakers?.[0];
    const market = bookmaker?.markets?.find((m) => m.key === 'h2h');
    if (!market) continue;

    const findPrice = (teamName) => market.outcomes.find((o) => o.name === teamName)?.price;
    const oddsHome = findPrice(event.home_team);
    const oddsAway = findPrice(event.away_team);
    const oddsDraw = market.outcomes.find((o) => o.name === 'Draw')?.price;
    if (!oddsHome || !oddsAway || !oddsDraw) continue;

    // Если матч уже есть и заморожен (стартовал) — коэффициенты больше не трогаем.
    await pool.query(
      `INSERT INTO matches (league_id, external_id, home_team, away_team, commence_time, odds_home, odds_draw, odds_away, odds_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         odds_home = EXCLUDED.odds_home,
         odds_draw = EXCLUDED.odds_draw,
         odds_away = EXCLUDED.odds_away,
         odds_updated_at = now()
       WHERE matches.is_frozen = false`,
      [league.id, event.id, event.home_team, event.away_team, event.commence_time, oddsHome, oddsDraw, oddsAway]
    );
  }
}

/**
 * Обходит все "живые" (не замороженные, ещё не начавшиеся) матчи и решает,
 * пора ли обновлять по ним коэффициенты, согласно правилу:
 *  - до 6 часов к началу матча -> обновление не чаще раза в час
 *  - более 6 часов к началу -> обновление 1-2 раза в сутки (раз в 12 часов)
 *  - момент начала матча настал -> коэффициент замораживается навсегда
 */
export async function reconcileOdds() {
  const { rows: leagues } = await pool.query('SELECT * FROM leagues');
  const leagueById = new Map(leagues.map((l) => [l.id, l]));

  const { rows: dueMatches } = await pool.query(
    `SELECT * FROM matches WHERE status = 'scheduled' AND is_frozen = false`
  );

  const now = Date.now();
  const toFreeze = [];
  const toUpdate = [];

  for (const match of dueMatches) {
    const kickoff = new Date(match.commence_time).getTime();
    const hoursToKickoff = (kickoff - now) / 3_600_000;
    const hoursSinceUpdate = (now - new Date(match.odds_updated_at).getTime()) / 3_600_000;

    if (hoursToKickoff <= 0) {
      toFreeze.push(match.id);
    } else if (hoursToKickoff <= 6 && hoursSinceUpdate >= 1) {
      toUpdate.push(match);
    } else if (hoursToKickoff > 6 && hoursSinceUpdate >= 12) {
      toUpdate.push(match);
    }
  }

  if (toFreeze.length) {
    await pool.query(`UPDATE matches SET is_frozen = true WHERE id = ANY($1::int[])`, [toFreeze]);
    console.log(`[odds] Заморожены коэффициенты у ${toFreeze.length} стартовавших матчей`);
  }

  if (USE_MOCK) {
    for (const match of toUpdate) {
      const fresh = jitterOdds(match);
      await pool.query(
        `UPDATE matches SET odds_home=$1, odds_draw=$2, odds_away=$3, odds_updated_at=now() WHERE id=$4`,
        [fresh.odds_home, fresh.odds_draw, fresh.odds_away, match.id]
      );
    }
    if (toUpdate.length) console.log(`[odds] Обновлены мок-коэффициенты у ${toUpdate.length} матчей`);
  } else {
    // В реальном режиме проще перезапросить всю лигу целиком, раз уж матчи в ней "созрели"
    const leaguesToRefresh = new Set(toUpdate.map((m) => m.league_id));
    for (const leagueId of leaguesToRefresh) {
      const league = leagueById.get(leagueId);
      if (league) await fetchRealOddsForLeague(league);
    }
  }
}
