-- 20261030100002: billing state the entitlement recompute needs (me-money §5.1, TRD §11).
-- Additive only: new columns on existing tables, all nullable or with defaults.
set search_path = public, extensions;

alter table billing.subscriptions
  add column grace_until    timestamptz,
  -- The provider time of the newest event applied, so an older event that arrives late never
  -- overwrites a newer state (webhooks are not ordered).
  add column last_event_at  timestamptz,
  add column refunded_at    timestamptz,
  add column revoked_at     timestamptz,
  -- Codes only (PAY-13 reason chips, provider cancel reasons), never free text.
  add column cancel_reason  text check (cancel_reason ~ '^[a-z0-9_]{1,40}$'),
  add column pending_reason text check (pending_reason in ('bank_confirming','parent_approval','store_pending')),
  add column variant_id     text,
  add column environment    text not null default 'production' check (environment in ('production','sandbox'));

-- The entitlement row carries what the clients show (me-money §5.1 "Server truth").
alter table billing.entitlements
  add column status               text check (status in
                                    ('active','trialing','grace','on_hold','cancelled','expired','pending')),
  add column source               text check (source in ('razorpay','play','app_store','promo')),
  add column is_intro             boolean not null default false,
  add column cancel_at_period_end boolean not null default false;

alter table billing.promo_grants
  add column cancelled_at timestamptz;

create index on billing.subscriptions (status) where status in ('trialing','active','grace');
