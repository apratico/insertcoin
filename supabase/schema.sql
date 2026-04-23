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

-- Play counts per game (most-played ranking)
create or replace function public.plays_per_game()
returns table (game_id text, plays bigint) as $$
  select game_id, count(*)::bigint as plays
  from public.scores
  group by game_id
  order by plays desc
$$ language sql stable;
