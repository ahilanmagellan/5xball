const BASE = '/api';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include', // отправляем httpOnly cookie с JWT
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ (204 и т.п.) */ }

  if (!res.ok) {
    const err = new Error(data?.error || `Ошибка запроса (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Загрузка файла — отдельно от request(), т.к. multipart/form-data нельзя
// JSON.stringify'ить и Content-Type должен выставляться браузером сам
// (с правильным boundary), а не вручную.
async function uploadRequest(path, file) {
  const formData = new FormData();
  formData.append('avatar', file);

  const res = await fetch(BASE + path, { method: 'POST', credentials: 'include', body: formData });
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }

  if (!res.ok) {
    const err = new Error(data?.error || `Ошибка запроса (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  register: (email, password, ref) => request('/auth/register', { method: 'POST', body: { email, password, ref } }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  setUsername: (username) => request('/auth/set-username', { method: 'POST', body: { username } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  leagues: () => request('/leagues'),
  leagueMatches: (key) => request(`/leagues/${key}/matches`),
  leagueStats: (key) => request(`/leagues/${key}/stats`),

  placeBet: (matchId, selection, amount) =>
    request('/bets', { method: 'POST', body: { match_id: matchId, selection, amount } }),
  myBets: () => request('/bets'),

  earnStatus: () => request('/earn/status'),
  earnClick: () => request('/earn/click', { method: 'POST' }),
  earnAd: () => request('/earn/ad', { method: 'POST' }),

  friendsOverview: () => request('/friends'),
  friendsSearch: (q) => request(`/friends/search?q=${encodeURIComponent(q)}`),
  friendRequest: (username) => request('/friends/request', { method: 'POST', body: { username } }),
  friendRespond: (requestId, action) => request('/friends/respond', { method: 'POST', body: { request_id: requestId, action } }),
  friendCancel: (requestId) => request('/friends/cancel', { method: 'POST', body: { request_id: requestId } }),
  friendProfile: (userId) => request(`/friends/${userId}/profile`),

  profileStats: () => request('/profile/stats'),
  uploadAvatar: (file) => uploadRequest('/profile/avatar/upload', file),

  referrals: () => request('/referrals'),
};
