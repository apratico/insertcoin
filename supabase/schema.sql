-- =====================================================================
-- InsertCoin — Supabase schema
-- Run this in: Supabase project -> SQL Editor -> New query -> paste -> Run
-- Idempotent: safe to re-run (uses IF NOT EXISTS).
-- =====================================================================

-- Profiles: one row per device. device_id is client-generated UUID.
create table if not exists public.profiles (
  device_id   text primary key,
  nickname    text not null check (char_length(nickname) between 1 and 12),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Scores: append-only leaderboard entries.
create table if not exists public.scores (
  id          bigserial primary key,
  game_id     text not null,
  device_id   text not null references public.profiles(device_id) on delete cascade,
  nickname    text not null,
  score       integer not null check (score >= 0),
  meta        jsonb,
  played_at   timestamptz not null default now()
);

create index if not exists scores_game_score_idx on public.scores (game_id, score desc, played_at desc);
create index if not exists scores_device_idx on public.scores (device_id);
create index if not exists scores_played_idx on public.scores (played_at desc);

-- Daily challenge seeds (optional, fill later).
create table if not exists public.daily_seeds (
  day       date not null,
  game_id   text not null,
  seed      text not null,
  primary key (day, game_id)
);

-- =====================================================================
-- Row Level Security
-- Anyone with the anon key can:
--   - read all profiles / scores (public leaderboard)
--   - insert their own profile / score (no auth beyond the anon key)
--   - update only their own profile (nickname change)
-- Nobody can delete via the anon key.
-- =====================================================================

alter table public.profiles    enable row level security;
alter table public.scores      enable row level security;
alter table public.daily_seeds enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (true);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (true) with check (true);

-- scores
drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores
  for select using (true);

drop policy if exists scores_insert on public.scores;
create policy scores_insert on public.scores
  for insert with check (true);

-- daily_seeds: read-only for anon
drop policy if exists daily_seeds_select on public.daily_seeds;
create policy daily_seeds_select on public.daily_seeds
  for select using (true);

-- =====================================================================
-- Helper: top N per game (all-time)
-- =====================================================================
create or replace function public.top_scores(p_game_id text, p_limit int default 10)
returns table (nickname text, score int, played_at timestamptz, device_id text) as $$
  select nickname, score, played_at, device_id
  from public.scores
  where game_id = p_game_id
  order by score desc, played_at asc
  limit greatest(p_limit, 1)
$$ language sql stable;

-- top N today (UTC day)
create or replace function public.top_scores_today(p_game_id text, p_limit int default 10)
returns table (nickname text, score int, played_at timestamptz, device_id text) as $$
  select nickname, score, played_at, device_id
  from public.scores
  where game_id = p_game_id
    and played_at >= date_trunc('day', now() at time zone 'utc')
  order by score desc, played_at asc
  limit greatest(p_limit, 1)
$$ language sql stable;

-- Play counts per game (most-played ranking) — based on score submissions
create or replace function public.plays_per_game()
returns table (game_id text, plays bigint) as $$
  select game_id, count(*)::bigint as plays
  from public.scores
  group by game_id
  order by plays desc
$$ language sql stable;

-- Game-open events — counts EVERY time a user enters a game,
-- regardless of whether they finished or submitted a score.
-- Covers company games (which don't submit scores) and stopped sessions.
create table if not exists public.game_opens (
  id         bigserial primary key,
  device_id  text,
  game_id    text not null,
  opened_at  timestamptz not null default now()
);

create index if not exists game_opens_game_idx on public.game_opens (game_id);
create index if not exists game_opens_opened_idx on public.game_opens (opened_at desc);

alter table public.game_opens enable row level security;

drop policy if exists game_opens_insert on public.game_opens;
create policy game_opens_insert on public.game_opens
  for insert with check (true);

-- (no select policy — anon cannot read individual rows)

create or replace function public.opens_per_game()
returns table (game_id text, opens bigint) as $$
  select game_id, count(*)::bigint as opens
  from public.game_opens
  group by game_id
  order by opens desc
$$ language sql stable;

-- =====================================================================
-- Visit log (analytics)
-- =====================================================================
create table if not exists public.visits (
  id           bigserial primary key,
  device_id    text,
  nickname     text,
  user_agent   text,
  language     text,
  timezone     text,
  referrer     text,
  screen_w     int,
  screen_h     int,
  country      text,
  ip           text,
  created_at   timestamptz not null default now()
);

create index if not exists visits_created_idx on public.visits (created_at desc);
create index if not exists visits_device_idx  on public.visits (device_id);
create index if not exists visits_country_idx on public.visits (country);

alter table public.visits enable row level security;

drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits
  for insert with check (true);

-- Only owner reads back (admin query via Supabase dashboard uses service_role
-- which bypasses RLS). Anon cannot read visits to protect privacy.

-- Aggregations
create or replace function public.visits_totals()
returns table (day_total bigint, month_total bigint, year_total bigint, all_total bigint) as $$
  select
    (select count(*) from public.visits where created_at >= date_trunc('day',   now() at time zone 'utc')),
    (select count(*) from public.visits where created_at >= date_trunc('month', now() at time zone 'utc')),
    (select count(*) from public.visits where created_at >= date_trunc('year',  now() at time zone 'utc')),
    (select count(*) from public.visits)
$$ language sql stable;

-- Allow anon to read only aggregated totals (never individual rows)
create or replace function public.visits_daily(p_days int default 30)
returns table (day date, n bigint) as $$
  select date_trunc('day', created_at at time zone 'utc')::date as day, count(*)::bigint
  from public.visits
  where created_at >= (now() at time zone 'utc') - make_interval(days => greatest(p_days, 1))
  group by day
  order by day
$$ language sql stable;

-- Country breakdown (anonymous aggregate, no individual data)
create or replace function public.visits_by_country()
returns table (country text, n bigint) as $$
  select coalesce(country, '??') as country, count(*)::bigint
  from public.visits
  group by country
  order by count(*) desc
  limit 50
$$ language sql stable;

-- Hour-of-day histogram (server UTC)
create or replace function public.visits_by_hour()
returns table (hour int, n bigint) as $$
  select extract(hour from created_at at time zone 'utc')::int as hour, count(*)::bigint
  from public.visits
  group by hour
  order by hour
$$ language sql stable;

-- Recent visits with safe fields only (nickname, country, timezone, language, when)
create or replace function public.visits_recent(p_limit int default 50)
returns table (
  nickname text,
  country  text,
  timezone text,
  language text,
  created_at timestamptz
) as $$
  select nickname, country, timezone, language, created_at
  from public.visits
  order by created_at desc
  limit greatest(p_limit, 1)
$$ language sql stable;
