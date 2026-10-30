-- Server notifications (TRD §12, me-money §6.1 and §6.2).
--
-- notify.outbox holds every server send before the rules engine decides it: features enqueue a
-- kind and a few ids in their own transaction (the outbox pattern), and the notifications worker
-- applies caps, quiet hours, school hours and the minors rules, renders the copy from the i18n
-- catalogues, sends, and writes notify.log. Service only: students never read or write it.

create table notify.outbox (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null,
  class        text not null check (class in
                 ('habit','learning','social','transactional','exam_alert','parent','re_engagement')),
  -- Ids and numbers that fill the copy and the deep link. Never study text or free text.
  payload      jsonb not null default '{}',
  deep_link    text,
  dedupe_key   text unique,
  not_before   timestamptz not null default now(),
  expires_at   timestamptz,
  status       text not null default 'queued'
                 check (status in ('queued','held','sent','suppressed','failed')),
  reason       text,
  attempts     smallint not null default 0,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index on notify.outbox (not_before) where status in ('queued','held');
create index on notify.outbox (user_id, created_at desc);

alter table notify.outbox enable row level security;
grant all on notify.outbox to service_role;

-- Which kind and audience each log row counted against (caps are read back from the log).
alter table notify.log
  add column kind  text,
  add column class text,
  add column outbox_id uuid;
create index on notify.log (user_id, class, sent_at desc);

-- Web Push subscriptions carry their own keys; the endpoint identifies the subscription.
create unique index on app.devices ((web_push_subscription ->> 'endpoint'))
  where web_push_subscription is not null;
