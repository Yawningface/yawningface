-- YawningFace Block — cloud schema v1
--
-- Run this in the Supabase SQL editor (or via the Supabase CLI).
-- It is safe to run more than once.
--
-- SECURITY MODEL (v1):
--   RLS is ENABLED on every table but NO policies are created.
--   The API accesses Postgres exclusively with the service-role key, which
--   bypasses RLS; enabling RLS with zero policies locks out the anon and
--   authenticated keys entirely. Per-user RLS policies are a v2 hardening
--   TODO (see README).

-- gen_random_uuid() lives in pgcrypto (pre-installed on Supabase).
create extension if not exists pgcrypto;

-- ── profiles ─────────────────────────────────────────────────────────────
-- One row per user. user_id is the Auth0 `sub` claim (text), the canonical
-- user id across the whole system. Upserted on first authenticated API call.
create table if not exists public.profiles (
  user_id      text primary key,
  display_name text,
  email        text,
  created_at   timestamptz not null default now()
);

-- ── devices ──────────────────────────────────────────────────────────────
-- Every client installation registers itself here via POST /api/v1/devices.
create table if not exists public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references public.profiles (user_id) on delete cascade,
  name         text not null,
  platform     text not null check (platform in ('mac', 'windows', 'linux', 'ios', 'android', 'extension')),
  app_version  text,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists devices_user_id_idx on public.devices (user_id);

-- ── configs ──────────────────────────────────────────────────────────────
-- The canonical blocklist config, one JSON document per user
-- (schema: docs/schema.md). Last write wins.
create table if not exists public.configs (
  user_id    text primary key references public.profiles (user_id) on delete cascade,
  config     jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── events ───────────────────────────────────────────────────────────────
-- Client telemetry (blocked attempts, sync pings, …) ingested in batches
-- via POST /api/v1/events. Feeds GET /api/v1/summary and the future digest.
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  user_id     text not null,
  device_id   uuid,
  type        text not null,
  payload     jsonb not null default '{}',
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists events_user_occurred_idx on public.events (user_id, occurred_at desc);
create index if not exists events_user_type_idx on public.events (user_id, type);

-- ── Row Level Security ───────────────────────────────────────────────────
-- Enabled with NO policies on purpose: the service-role key (server-side
-- only) bypasses RLS, and every other key is denied all access.
alter table public.profiles enable row level security;
alter table public.devices  enable row level security;
alter table public.configs  enable row level security;
alter table public.events   enable row level security;
