-- =========================================================
-- Схема БД "Симулятор футбольного букмекера"
-- Запускается через `npm run migrate`. Все команды идемпотентны
-- (IF NOT EXISTS), поэтому скрипт можно гонять повторно.
-- =========================================================

-- Пользователи
-- Регистрация двухшаговая: сначала email+пароль (username ещё NULL),
-- затем отдельным запросом придумывается никнейм — поэтому username
-- nullable, а логином/уникальным идентификатором служит email.
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          VARCHAR(255),
  username       VARCHAR(20) UNIQUE,
  password_hash  TEXT NOT NULL,               -- bcrypt-хэш, пароль в открытом виде нигде не хранится
  balance        NUMERIC(12,2) NOT NULL DEFAULT 1000.00,
  avatar_id      SMALLINT NOT NULL DEFAULT 1, -- 1..6, готовые игровые иконки — используется, пока не загружена своя фотка
  avatar_url     TEXT,                        -- путь к загруженной пользователем картинке; если задан, имеет приоритет над avatar_id
  referral_code    VARCHAR(12) UNIQUE,        -- свой код для реферальной ссылки, выдаётся при регистрации
  referred_by      INTEGER REFERENCES users(id), -- кто пригласил этого пользователя (по чьей ссылке пришёл)
  referral_rewarded BOOLEAN NOT NULL DEFAULT false, -- начислена ли уже пригласившему награда за ЭТОГО пользователя
  last_click_at    TIMESTAMPTZ,               -- для антифрод-кулдауна кликера
  last_ad_watch_at TIMESTAMPTZ,               -- для антифрод-кулдауна "просмотра рекламы"
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ALTER-блок ниже нужен только для БД, созданных до этого изменения схемы
-- (CREATE TABLE выше не тронет уже существующую таблицу) — идемпотентно.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_rewarded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;

-- Бэкфилл: аккаунтам, созданным до появления реферальной системы, тоже
-- нужен код для ссылки. На новых регистрациях эта строка ничего не находит.
UPDATE users SET referral_code = substr(md5(random()::text || id::text), 1, 10) WHERE referral_code IS NULL;

-- Лиги/турниры
CREATE TABLE IF NOT EXISTS leagues (
  id             SERIAL PRIMARY KEY,
  key            VARCHAR(30) UNIQUE NOT NULL,   -- 'epl', 'la_liga', 'ucl' — используется во фронте и в URL
  name           VARCHAR(100) NOT NULL,
  api_sport_key  VARCHAR(100),                  -- ключ спорта в The Odds API, напр. 'soccer_epl'
  logo_url       TEXT,                          -- эмблема лиги (кэш из TheSportsDB)
  sort_order     SMALLINT NOT NULL DEFAULT 0
);
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Кэш логотипов команд по названию — чтобы не дёргать внешний API повторно.
-- Не привязан к конкретной лиге/матчу: одно и то же название команды
-- переиспользуется у всех матчей с её участием.
CREATE TABLE IF NOT EXISTS team_logos (
  team_name   TEXT PRIMARY KEY,
  logo_url    TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Матчи с кэшированными коэффициентами
CREATE TABLE IF NOT EXISTS matches (
  id               SERIAL PRIMARY KEY,
  league_id        INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  external_id      VARCHAR(100),                -- id события в The Odds API/TheSportsDB, для upsert без дублей
  home_team        VARCHAR(100) NOT NULL,
  away_team        VARCHAR(100) NOT NULL,
  commence_time    TIMESTAMPTZ NOT NULL,
  round_number     SMALLINT,                    -- номер тура (из реального расписания); NULL для мок-фолбэка
  odds_home        NUMERIC(6,2) NOT NULL,
  odds_draw        NUMERIC(6,2) NOT NULL,
  odds_away        NUMERIC(6,2) NOT NULL,
  odds_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_frozen        BOOLEAN NOT NULL DEFAULT false, -- true = кэф больше не обновляется (матч стартовал/завершён)
  status           VARCHAR(12) NOT NULL DEFAULT 'scheduled', -- scheduled | finished
  result           CHAR(1),                     -- 'H' | 'D' | 'A', заполняется после завершения
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS round_number SMALLINT;
CREATE INDEX IF NOT EXISTS idx_matches_league ON matches(league_id, status, commence_time);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_external ON matches(external_id) WHERE external_id IS NOT NULL;

-- Ставки пользователей
CREATE TABLE IF NOT EXISTS bets (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id      INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  league_id     INTEGER NOT NULL REFERENCES leagues(id), -- денормализация ради быстрой статистики по лиге
  selection     CHAR(1) NOT NULL CHECK (selection IN ('H','D','A')),
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  odds_at_bet   NUMERIC(6,2) NOT NULL,           -- фиксируем кэф на момент ставки
  status        VARCHAR(10) NOT NULL DEFAULT 'pending', -- pending | won | lost
  payout        NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_user_league ON bets(user_id, league_id);
CREATE INDEX IF NOT EXISTS idx_bets_match ON bets(match_id);

-- Дружба: одна таблица "заявок" моделирует связь многие-ко-многим со статусом.
-- pending  -> заявка отправлена, ждёт решения
-- accepted -> пара считается друзьями (неважно, кто был sender)
-- declined -> заявку отклонили (остаётся в истории, новую можно отправить повторно)
CREATE TABLE IF NOT EXISTS friend_requests (
  id            SERIAL PRIMARY KEY,
  sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  CHECK (sender_id <> receiver_id),
  UNIQUE (sender_id, receiver_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_receiver ON friend_requests(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_sender ON friend_requests(sender_id, status);
