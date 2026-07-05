import { pool } from '../db/pool.js';
import { SPORTSDB_API_BASE, fetchJson } from './sportsDbClient.js';

/** Эмблема лиги по стабильному числовому id из TheSportsDB (надёжнее, чем поиск по имени). */
export async function fetchLeagueLogoById(leagueId) {
  const data = await fetchJson(`${SPORTSDB_API_BASE}/lookupleague.php?id=${leagueId}`);
  const league = data?.leagues?.[0];
  return league?.strBadge || league?.strLogo || null;
}

/** Записывает логотип команды в кэш team_logos напрямую (когда URL уже известен, например пришёл вместе с расписанием матча). */
export async function cacheTeamLogo(teamName, logoUrl) {
  if (!logoUrl) return;
  await pool.query(
    `INSERT INTO team_logos (team_name, logo_url) VALUES ($1, $2)
     ON CONFLICT (team_name) DO UPDATE SET logo_url = EXCLUDED.logo_url, fetched_at = now()`,
    [teamName, logoUrl]
  );
}

/**
 * Логотип команды по названию. Результат кэшируется в team_logos навсегда —
 * повторные посевы (`npm run seed`) не будут заново дёргать внешний API.
 */
export async function getOrFetchTeamLogo(teamName) {
  const { rows } = await pool.query('SELECT logo_url FROM team_logos WHERE team_name = $1', [teamName]);
  if (rows.length) return rows[0].logo_url;

  const data = await fetchJson(`${SPORTSDB_API_BASE}/searchteams.php?t=${encodeURIComponent(teamName)}`);
  const team = data?.teams?.[0];
  const logoUrl = team?.strBadge || team?.strLogo || null;

  if (logoUrl) await cacheTeamLogo(teamName, logoUrl);
  return logoUrl;
}
