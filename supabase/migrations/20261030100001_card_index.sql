-- 20261030100001: the server's copy of the device `cards_index` (DB_SCHEMA §16, memory-labs §5.14).
-- System review cards live in the lesson bundles on R2. The server needs to know which cards teach
-- a concept so that `cards_queued {concept_ids}` (R52) and `POST /v1/reviews/queue` can start the
-- same cards the device starts. The content publish job fills this table from the published
-- lessons right after it applies metadata.sql.
set search_path = public, extensions;

create table content.card_index (
  card_id      text primary key,
  item_id      text not null references content.content_items(id) on delete cascade,
  topic_id     text not null references content.topics(id),
  mode         text not null check (mode in ('deep_dive','quick_revision')),
  kind         text not null,
  concept_ids  text[] not null,
  ordinal      smallint not null,
  sibling_key  text,
  priority     text check (priority in ('core','standard')),
  status       text not null default 'published' check (status in ('published','retired')),
  updated_at   timestamptz not null default now()
);
create index on content.card_index using gin (concept_ids);
create index on content.card_index (item_id);

alter table content.card_index enable row level security;
create policy public_read on content.card_index for select to anon, authenticated
  using (status = 'published');
grant select on content.card_index to anon, authenticated;
grant all on content.card_index to service_role;
