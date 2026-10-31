-- Memory palaces as a synced feature (memory-labs flow §5.6, sync contract v1.5).
--
-- The tables from 20261029000004 stay; this adds what the builder needs:
--   learn.palaces        template_id (a palace_template@1 id), source (what the items came from:
--                        a list or date concept, a topic, a deck or the student's mnemonics)
--                        and client_updated_at (the device's last edit; an older snapshot from a
--                        slower device is ignored, so the newest edit wins)
--   learn.palace_rooms   template_room (the template's room slug, for its picture and alt text)
--   learn.palace_loci    now the room's spots: walk order (sort) and position. Items no longer
--                        live on a locus, so item_ref becomes optional (kept for old rows).
--   learn.palace_items   the things memorised: item_ref (kp:, card:, c:, d:, q:, m: or a concept
--                        id), a label and a note the student wrote, and the spot it sits on (null:
--                        still in the tray). One item per spot. A removed item's row is deleted
--                        (its words go with it); a deleted palace keeps only an empty row
--                        (deleted_at, no name, no rooms or items) so an older copy from a
--                        slower device can't bring it back.
--
-- The quiz schedule is not a separate table: each item is an FSRS card `p:<item_id>` in
-- learn.srs_cards, rated with review_rated (srs_reviews.context = 'palace_walk'), so palace spots
-- share the review queue, the streak and the state sync with every other card.
set search_path = public, extensions;

alter table learn.palaces
  add column template_id       text check (template_id ~ '^pt\.[a-z0-9]+(-[a-z0-9]+)*$'),
  add column source            text check (source in ('list', 'topic', 'deck', 'mnemonics')),
  add column client_updated_at timestamptz not null default now();

alter table learn.palace_rooms
  add column template_room text check (template_room ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

alter table learn.palace_loci alter column item_ref drop not null;
create unique index palace_loci_room_sort on learn.palace_loci (room_id, sort);
create index palace_rooms_palace_sort on learn.palace_rooms (palace_id, sort);

create table learn.palace_items (
  id          uuid primary key,                       -- client UUIDv7; the card is p:<id>
  palace_id   uuid not null references learn.palaces(id) on delete cascade,
  item_ref    text not null check (item_ref ~ '^[A-Za-z0-9_.:#-]{1,240}$'),
  label       text check (char_length(label) <= 200),  -- the student's own words: never in analytics
  note        text check (char_length(note) <= 300),   -- MEM-16 note: never in analytics
  locus_id    uuid references learn.palace_loci(id) on delete set null,
  sort        smallint not null default 0,            -- order in the tray
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on learn.palace_items (palace_id);
create unique index palace_items_one_per_spot on learn.palace_items (locus_id)
  where locus_id is not null;
create trigger palace_items_touch before update on learn.palace_items
  for each row execute function app.touch_updated_at();

-- An item's spot must be a spot of the same palace (so no one can point at, or block, a spot
-- in someone else's palace). Runs as the caller, so RLS hides other people's spots too.
create function learn.palace_item_spot_check() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.locus_id is not null and not exists (
    select 1 from learn.palace_loci l join learn.palace_rooms r on r.id = l.room_id
     where l.id = new.locus_id and r.palace_id = new.palace_id
  ) then
    raise exception 'a palace item can only sit on a spot of its own palace' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger palace_items_spot before insert or update of locus_id, palace_id on learn.palace_items
  for each row execute function learn.palace_item_spot_check();

-- RLS: owner via the palace, like palace_rooms and palace_loci (DB_SCHEMA §12).
alter table learn.palace_items enable row level security;
grant select, insert, update, delete on learn.palace_items to authenticated;
grant all on learn.palace_items to service_role;
create policy owner_via_parent on learn.palace_items for all to authenticated
  using (exists (select 1 from learn.palaces p
                  where p.id = palace_items.palace_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from learn.palaces p
                       where p.id = palace_items.palace_id and p.user_id = (select auth.uid())));
