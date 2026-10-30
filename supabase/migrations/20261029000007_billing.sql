-- 0007: billing (DB_SCHEMA §8). subscriptions, payments and payment_events have no FK to
-- auth.users: they are kept for tax after erasure with a tombstone user id.
set search_path = public, extensions;

create table billing.products (
  id                text primary key,
  platform          text not null check (platform in ('web','android','ios')),
  variant_id        text,
  store_product_id  text not null,
  price_paise       integer not null,
  intro_price_paise integer,
  period            text not null check (period in ('month','year')),
  entitlement       text not null default 'pro',
  active            boolean not null default true
);

create table billing.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null,
  source                text not null check (source in ('razorpay','play','app_store','promo')),
  external_id           text not null,
  payer                 text not null default 'self' check (payer in ('self','guardian_declared','guardian')),
  product_id            text not null references billing.products(id),
  status                text not null check (status in
                          ('created','authenticated','pending','trialing','active','grace','on_hold','paused','cancelled','halted','expired')),
  is_intro              boolean not null default false,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean not null default false,
  started_at            timestamptz,
  ended_at              timestamptz,
  updated_at            timestamptz not null default now(),
  unique (source, external_id)
);
create index on billing.subscriptions (user_id);
create trigger subscriptions_touch before update on billing.subscriptions
  for each row execute function app.touch_updated_at();

create table billing.entitlements (
  user_id          uuid not null references auth.users(id) on delete cascade,
  entitlement      text not null,
  active           boolean not null,
  subscription_id  uuid references billing.subscriptions(id),
  expires_at       timestamptz,
  grace_until      timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (user_id, entitlement)
);
create trigger entitlements_touch before update on billing.entitlements
  for each row execute function app.touch_updated_at();

create table billing.payments (
  id                   uuid primary key default gen_random_uuid(),
  subscription_id      uuid not null references billing.subscriptions(id),
  external_payment_id  text not null unique,
  amount_paise         integer not null,
  status               text not null check (status in ('captured','failed','refunded')),
  method               text,
  paid_at              timestamptz not null
);

create table billing.payment_events (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null,
  external_event_id  text not null,
  event_type         text not null,
  user_id            uuid,
  payload            jsonb not null,
  signature_ok       boolean not null,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  error              text,
  unique (source, external_event_id)
);

create table billing.promo_grants (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  reason       text not null check (reason in ('referral_week')),
  ref          text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_at   timestamptz not null default now()
);
create index on billing.promo_grants (user_id, ends_at desc);

create table billing.payment_links (
  id               uuid primary key default gen_random_uuid(),
  learner_user_id  uuid not null references auth.users(id) on delete cascade,
  token_hash       text not null unique,
  product_id       text not null references billing.products(id),
  status           text not null default 'open' check (status in ('open','paid','expired','cancelled')),
  expires_at       timestamptz not null,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);

create table billing.intro_claims (
  claim_key    text primary key,
  key_kind     text not null check (key_kind in ('google_sub','apple_sub')),
  key_version  smallint not null default 1,
  user_id      uuid,
  source       text not null,
  variant_id   text,
  claimed_at   timestamptz not null default now()
);
create index on billing.intro_claims (user_id);
