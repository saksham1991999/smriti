-- Shop item names as i18n keys (ME-17): the shop shows each item by a catalogue key in
-- packages/i18n ("namespace:key"), never by text stored here (AGENTS rule 7). Null for an item
-- whose key isn't written yet; the apps then hide it.
alter table game.shop_items
  add column name_key text check (name_key ~ '^[a-z_]+:[A-Za-z0-9_.-]+$');
