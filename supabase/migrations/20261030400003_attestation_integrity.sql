-- Device attestation and anti-cheat flags (IMPLEMENTATION_PLAN G-10, TRD §10, §14).
--
-- app.attest_keys keeps each iOS App Attest key the server verified: its public key, the App ID
-- it was attested for and the last assertion counter (which must only go up). A key belongs to
-- an app install, not to a person, so the registering user is kept only to clear it on erasure.
--
-- ops.integrity_flags records signals for the anti-cheat review: sync events faster than the
-- plausible minimum, XP held back by the hourly cap, and failed attestations. Flags never reject
-- or undo anything by themselves (TRD §10); they hold event ids and numbers, never content.
-- Both tables are service-only.
set search_path = public, extensions;

create table app.attest_keys (
  key_id       text primary key check (key_id ~ '^[A-Za-z0-9+/=_-]{8,128}$'),
  user_id      uuid references auth.users(id) on delete set null,
  device_id    uuid,
  app_id       text not null,
  environment  text not null check (environment in ('production', 'development')),
  public_key   bytea not null,
  sign_count   bigint not null default 0 check (sign_count >= 0),
  receipt      bytea,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index on app.attest_keys (user_id);

alter table app.attest_keys enable row level security;
revoke all on app.attest_keys from authenticated, anon;
grant all on app.attest_keys to service_role;

create table ops.integrity_flags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  source      text not null check (source in ('sync', 'attestation', 'duel', 'mock')),
  kind        text not null check (kind ~ '^[a-z0-9_-]{1,40}$'),
  events      integer not null default 1 check (events > 0),
  event_ids   uuid[] not null default '{}',
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  review_note text
);
create index on ops.integrity_flags (user_id, created_at desc);
create index on ops.integrity_flags (created_at) where reviewed_at is null;

alter table ops.integrity_flags enable row level security;
revoke all on ops.integrity_flags from authenticated, anon;
grant all on ops.integrity_flags to service_role;
