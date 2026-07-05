import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/pool.js';
import { generateMockOdds } from './oddsService.js';
import { cacheTeamLogo, fetchLeagueLogoById } from './logoService.js';
import { SPORTSDB_API_BASE, fetchJson } from './sportsDbClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Достаёт из TheSportsDB реальный ближайший тур лиги:
 *  1) eventsnextleague.php -> ближайшее событие, из него берём номер тура и сезон;
 *  2) eventsround.php по этому туру/сезону -> все матчи этого тура.
 * Бесплатный ключ отдаёт максимум ~5 матчей на запрос — на практике это как
 * раз похоже на один тур, поэтому ставки естественным образом ограничены
 * "ближайшим туром": в БД одновременно лежат матчи только одного тура на лигу.
 */
export async function fetchNearestRoundFixtures(leagueId) {
  const nextData = await fetchJson(`${SPORTSDB_API_BASE}/eventsnextleague.php?id=${leagueId}`);
  const nextEvent = nextData?.events?.[0];
  if (!nextEvent) return [];

  const round = nextEvent.intRound;
  const season = nextEvent.strSeason;
  const roundData = await fetchJson(
    `${SPORTSDB_API_BASE}/eventsround.php?id=${leagueId}&r=${encodeURIComponent(round)}&s=${encodeURIComponent(season)}`
  );
  const events = roundData?.events || [nextEvent];

  return events
    .filter((e) => e.strHomeTeam && e.strAwayTeam && e.strTimestamp)
    .map((e) => ({
      externalId: `sdb-${e.idEvent}`,
      homeTeam: e.strHomeTeam,
      awayTeam: e.strAwayTeam,
      commenceTime: e.strTimestamp,
      round: Number(e.intRound) || null,
      homeLogo: e.strHomeTeamBadge || null,
      awayLogo: e.strAwayTeamBadge || null,
    }));
}

/**
 * Гарантирует, что у лиги есть запланированные матчи: если текущий тур ещё
 * не сыгран целиком — ничего не делает. Если матчей нет (первый запуск или
 * предыдущий тур полностью рассчитан) — пробует подтянуть реальный
 * ближайший тур, а если это не удалось (нет сети/лига без fixtures) —
 * откатывается на генерацию мок-тура из списка команд в конфиге.
 */
export async function ensureLeagueHasFixtures(leagueId, league) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS c FROM matches WHERE league_id = $1 AND status = 'scheduled'`,
    [leagueId]
  );
  if (rows[0].c > 0) return { inserted: 0, skipped: true };

  let fixtures = [];
  if (league.thesportsdb_league_id) {
    try {
      fixtures = await fetchNearestRoundFixtures(league.thesportsdb_league_id);
    } catch (err) {
      console.warn(`[fixtures] Не удалось получить реальные матчи для "${league.name}": ${err.message}`);
    }
  }

  if (fixtures.length > 0) {
    for (const f of fixtures) {
      const odds = generateMockOdds();
      await pool.query(
        `INSERT INTO matches (league_id, external_id, home_team, away_team, commence_time, round_number, odds_home, odds_draw, odds_away)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING`,
        [leagueId, f.externalId, f.homeTeam, f.awayTeam, f.commenceTime, f.round, odds.odds_home, odds.odds_draw, odds.odds_away]
      );
      await cacheTeamLogo(f.homeTeam, f.homeLogo);
      await cacheTeamLogo(f.awayTeam, f.awayLogo);
    }
    return { inserted: fixtures.length, real: true, round: fixtures[0].round };
  }

  if (!league.teams?.length) return { inserted: 0, skipped: true };

  // Мок-фолбэк: используется только если реальное расписание недоступно
  // (нет интернета, лига без объявленных fixtures и т.п.)
  const teams = shuffle(league.teams);
  const pairsCount = Math.floor(teams.length / 2);
  const offsetsHours = [1, 3, 6, 26, 30, 50];
  for (let i = 0; i < pairsCount; i++) {
    const odds = generateMockOdds();
    const commenceTime = new Date(Date.now() + offsetsHours[i % offsetsHours.length] * 3_600_000);
    await pool.query(
      `INSERT INTO matches (league_id, home_team, away_team, commence_time, odds_home, odds_draw, odds_away)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [leagueId, teams[i * 2], teams[i * 2 + 1], commenceTime, odds.odds_home, odds.odds_draw, odds.odds_away]
    );
  }
  return { inserted: pairsCount, real: false };
}

/**
 * Единая точка входа для наполнения БД: upsert'ит все лиги из mockLeagues.json,
 * подтягивает им эмблемы и гарантирует наличие матчей ближайшего тура.
 * Вызывается и из `npm run seed`, и периодически из cron-джобы —
 * поэтому вся логика живёт в одном месте.
 */
export async function syncAllLeagues() {
  const raw = fs.readFileSync(path.join(__dirname, '../mock/mockLeagues.json'), 'utf-8');
  const leaguesData = JSON.parse(raw);

  for (const [key, league] of Object.entries(leaguesData)) {
    const { rows } = await pool.query(
      `INSERT INTO leagues (key, name, api_sport_key, sort_order)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order
       RETURNING id, logo_url`,
      [key, league.name, league.api_sport_key ?? null, league.sort_order]
    );
    const leagueId = rows[0].id;

    if (!rows[0].logo_url && league.thesportsdb_league_id) {
      const logoUrl = await fetchLeagueLogoById(league.thesportsdb_league_id);
      if (logoUrl) await pool.query('UPDATE leagues SET logo_url = $1 WHERE id = $2', [logoUrl, leagueId]);
    }

    const result = await ensureLeagueHasFixtures(leagueId, league);
    if (result.skipped) {
      console.log(`[fixtures] "${league.name}": текущий тур ещё не завершён, пропуск`);
    } else {
      console.log(
        `[fixtures] "${league.name}": добавлено ${result.inserted} матчей` +
          (result.real ? ` (реальные, тур ${result.round ?? '?'})` : ' (мок-тур, реальное расписание недоступно)')
      );
    }
  }
}
