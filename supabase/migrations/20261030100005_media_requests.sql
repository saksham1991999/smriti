-- Image requests for the media worker (skills/visual-director, TRD §5 "Jobs" media queue).
--
-- The content pipeline records each picture a content file asks for; the media worker generates it
-- with Agnes through the AI gateway (AGENTS rule 2: every illustration comes from Agnes), stores
-- the file behind the storage interface (R2, or local disk in development) and writes a
-- content.media_assets row in 'staging' for review. Service only.

create table ops.media_requests (
  id            uuid primary key default gen_random_uuid(),
  -- The media ref the content asks for (for example img.chapter-a.fx-hook) and who asked.
  ref           text not null,
  requested_by  text not null,
  prompt        text not null check (length(prompt) between 1 and 4000),
  style_preset  text,
  size          text not null default '1K' check (size in ('1K','2K','4K')),
  ratio         text not null default '1:1' check (ratio ~ '^[0-9]{1,2}:[0-9]{1,2}$'),
  alt           i18n_text not null,
  tags          text[] not null default '{}',
  seed          integer,
  status        text not null default 'queued'
                  check (status in ('queued','generating','done','failed')),
  attempts      smallint not null default 0,
  error         text,
  asset_id      uuid references content.media_assets(id) on delete set null,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index on ops.media_requests (status, created_at) where status in ('queued','generating');
create index on ops.media_requests (ref);

alter table ops.media_requests enable row level security;
grant all on ops.media_requests to service_role;
