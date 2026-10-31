-- 60001: little learner content items (PRD §6 "Class 1–5: story, song and play").
--
-- * content.content_items.kind gains 'song' (song@1: a rhyme or song with per-locale lyrics and
--   sung audio) and 'play' (play@1: tap, match, sort, drag and trace rounds). Both ship in
--   activity bundles (content.bundles.mode 'story', 'song' or 'play'; that column is free text).
set search_path = public, extensions;

alter table content.content_items drop constraint if exists content_items_kind_check;
alter table content.content_items add constraint content_items_kind_check
  check (kind in
    ('lesson','flashcard_set','mnemonic','cheat_sheet','revision_sheet','storybook','song','play',
     'sim','model3d','pano360','video','experiment','mind_map_template'));
