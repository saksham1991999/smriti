-- Local development only (scripts/dev/db.sh). Never applied on release: `migrate --seed` reads
-- seed.sql alone. The production quest catalogue is the owner's product config (me-money §3.7).
--
-- Quests for ME-20, from the rules in docs/flows/me-money.md §3.6 and §3.7 and docs/ux/me-money.md
-- ME-20: three daily quests and a weekly one, each worded by an ME-20 template key, rewards shown
-- up front, nothing random. Where a value comes from:
--   lessons: "Finish 2 lessons, reward 10 gems" is ME-20's own accessibility example.
--   reviews: 10 cards, the reviews that make a streak day (R1, streak.reviews_to_qualify).
--   minutes: 10 minutes, the default daily goal (R6, ONB-08).
--   daily gems: 10, inside game.economy.daily_quest_gems (5 to 15) and ME-20's example.
--   weekly: the default daily goal for 7 days (70 minutes), game.economy.weekly_quest_gems (50).
-- The owner tunes all of these in the real catalogue; ids start with dev. so they are obvious.
insert into game.quests (id, period, spec, reward, active_from) values
  ('dev.daily.lessons', 'daily',
   '{"counter": "lessons_completed", "target": 2, "title_key": "me_money:ME-20.template_lessons"}',
   '{"gems": 10}', '2026-01-01'),
  ('dev.daily.reviews', 'daily',
   '{"counter": "cards_reviewed", "target": 10, "title_key": "me_money:ME-20.template_reviews"}',
   '{"gems": 10}', '2026-01-01'),
  ('dev.daily.minutes', 'daily',
   '{"counter": "minutes", "target": 10, "title_key": "me_money:ME-20.template_minutes"}',
   '{"gems": 10}', '2026-01-01'),
  ('dev.weekly.minutes', 'weekly',
   '{"counter": "minutes", "target": 70, "title_key": "me_money:ME-20.template_minutes"}',
   '{"gems": 50}', '2026-01-01')
on conflict (id) do nothing;
