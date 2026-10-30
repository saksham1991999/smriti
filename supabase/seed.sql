-- Config rows only: exam profile shells, app variants, flags, prices and the gem shop basics.
-- No study content (AGENTS.md rule 1): subjects, chapters, concepts, questions and lessons come
-- from content/ through the content-publish job.
--
-- Values marked "R.." come from the orchestrator rulings (DECISIONS.md). Values marked
-- "proposed" are starting points for the owner to tune; they are product config, never facts
-- shown to students. Exam conducting bodies, URLs and schedules are left null on purpose: the
-- exam-blueprint skill fills them from the official notification (AGENTS.md rule 3).

-- Exams and exam profiles (shells). Phase 1: JEE, NEET, UPSC, classes 9-12; SSC is Phase 2 (R7).
insert into content.exams (id, name, category, is_active) values
  ('jee-main',     '{"en":"JEE Main","hi":"जेईई मेन"}', 'engineering', true),
  ('jee-advanced', '{"en":"JEE Advanced","hi":"जेईई एडवांस्ड"}', 'engineering', true),
  ('neet-ug',      '{"en":"NEET UG","hi":"नीट यूजी"}', 'medical', true),
  ('upsc-cse',     '{"en":"UPSC Civil Services","hi":"यूपीएससी सिविल सेवा"}', 'civil_services', true),
  ('ssc-cgl',      '{"en":"SSC CGL","hi":"एसएससी सीजीएल"}', 'ssc', false),
  ('cbse-9',       '{"en":"CBSE Class 9","hi":"सीबीएसई कक्षा 9"}', 'school', true),
  ('cbse-10',      '{"en":"CBSE Class 10","hi":"सीबीएसई कक्षा 10"}', 'school', true),
  ('cbse-11',      '{"en":"CBSE Class 11","hi":"सीबीएसई कक्षा 11"}', 'school', true),
  ('cbse-12',      '{"en":"CBSE Class 12","hi":"सीबीएसई कक्षा 12"}', 'school', true)
on conflict (id) do nothing;

insert into content.exam_profiles (id, exam_id, cycle, name, is_active) values
  ('jee-main-2027',     'jee-main',     '2027', '{"en":"JEE Main 2027","hi":"जेईई मेन 2027"}', true),
  ('jee-advanced-2027', 'jee-advanced', '2027', '{"en":"JEE Advanced 2027","hi":"जेईई एडवांस्ड 2027"}', true),
  ('neet-ug-2027',      'neet-ug',      '2027', '{"en":"NEET UG 2027","hi":"नीट यूजी 2027"}', true),
  ('upsc-cse-2027',     'upsc-cse',     '2027', '{"en":"UPSC Civil Services 2027","hi":"यूपीएससी सिविल सेवा 2027"}', true),
  ('ssc-cgl-2027',      'ssc-cgl',      '2027', '{"en":"SSC CGL 2027","hi":"एसएससी सीजीएल 2027"}', false),
  ('cbse-9-2027',       'cbse-9',       '2027', '{"en":"CBSE Class 9 (2027)","hi":"सीबीएसई कक्षा 9 (2027)"}', true),
  ('cbse-10-2027',      'cbse-10',      '2027', '{"en":"CBSE Class 10 (2027)","hi":"सीबीएसई कक्षा 10 (2027)"}', true),
  ('cbse-11-2027',      'cbse-11',      '2027', '{"en":"CBSE Class 11 (2027)","hi":"सीबीएसई कक्षा 11 (2027)"}', true),
  ('cbse-12-2027',      'cbse-12',      '2027', '{"en":"CBSE Class 12 (2027)","hi":"सीबीएसई कक्षा 12 (2027)"}', true)
on conflict (id) do nothing;

-- App variants (mirror of packages/config/variants for the API).
insert into ops.app_variants (id, exam_profile_ids, min_version, latest_version, config, active) values
  ('all',  array['jee-main-2027','jee-advanced-2027','neet-ug-2027','upsc-cse-2027',
                 'cbse-9-2027','cbse-10-2027','cbse-11-2027','cbse-12-2027'], '0.1.0', '0.1.0', '{}', true),
  ('jee',  array['jee-main-2027','jee-advanced-2027'], '0.1.0', '0.1.0', '{}', true),
  ('neet', array['neet-ug-2027'], '0.1.0', '0.1.0', '{}', true),
  ('upsc', array['upsc-cse-2027'], '0.1.0', '0.1.0', '{}', true),
  ('ssc',  array['ssc-cgl-2027'], '0.1.0', '0.1.0', '{}', false)
on conflict (id) do nothing;

-- Prices (paise, tax-inclusive, R38). Pro is ₹99/month with a ₹1 first month (PRD §11.2).
-- store_product_id values are placeholders until the Razorpay plan and store products exist.
insert into billing.products (id, platform, variant_id, store_product_id, price_paise, intro_price_paise, period, active) values
  ('pro_monthly_web',           'web',     null,  'pending:razorpay_plan', 9900, null, 'month', true),
  ('pro_monthly_intro_web',     'web',     null,  'pending:razorpay_plan_intro', 9900, 100, 'month', true),
  ('pro_monthly_android_all',   'android', 'all', 'pending:play_product', 9900, null, 'month', true),
  ('pro_monthly_intro_android_all', 'android', 'all', 'pending:play_product_intro', 9900, 100, 'month', true),
  ('pro_monthly_ios_all',       'ios',     'all', 'pending:app_store_product', 9900, null, 'month', true),
  ('pro_monthly_intro_ios_all', 'ios',     'all', 'pending:app_store_product_intro', 9900, 100, 'month', true)
on conflict (id) do nothing;

-- The ₹799/year plan (PRD §11.2), no intro offer. Family plans (PRD §11.2, Phase 3) have no price
-- here: it comes from the owner flags billing.family_{monthly,yearly}_price_paise, and the plan
-- stays hidden while that flag or billing.family_seats is unset (migration 20261030500002).
insert into billing.products (id, platform, variant_id, store_product_id, price_paise, intro_price_paise, period, active, plan) values
  ('pro_yearly_web',            'web',     null,  'pending:razorpay_plan_yearly', 79900, null, 'year', true, 'individual'),
  ('pro_yearly_android_all',    'android', 'all', 'pending:play_product_yearly', 79900, null, 'year', true, 'individual'),
  ('pro_yearly_ios_all',        'ios',     'all', 'pending:app_store_product_yearly', 79900, null, 'year', true, 'individual'),
  ('family_monthly_web',        'web',     null,  'pending:razorpay_plan_family_monthly', null, null, 'month', true, 'family'),
  ('family_monthly_android_all','android', 'all', 'pending:play_product_family_monthly', null, null, 'month', true, 'family'),
  ('family_monthly_ios_all',    'ios',     'all', 'pending:app_store_product_family_monthly', null, null, 'month', true, 'family'),
  ('family_yearly_web',         'web',     null,  'pending:razorpay_plan_family_yearly', null, null, 'year', true, 'family'),
  ('family_yearly_android_all', 'android', 'all', 'pending:play_product_family_yearly', null, null, 'year', true, 'family'),
  ('family_yearly_ios_all',     'ios',     'all', 'pending:app_store_product_family_yearly', null, null, 'year', true, 'family')
on conflict (id) do nothing;

-- Gem shop basics (me-money flow §3.6 starting prices). Gems are never sold for money (R36).
insert into game.shop_items (id, kind, price_gems, pro_only, active) values
  ('streak_freeze', 'freeze', 200, false, true),
  ('pet_treat',     'treat',   20, false, true)
on conflict (id) do nothing;

-- Flags served by GET /v1/config.
insert into ops.flags (key, value, description) values
  -- Streak (R1, R23, R28, R36)
  ('streak.reviews_to_qualify', '10', 'R1: reviews that make a streak day'),
  ('streak.freeze_slots_max', '2', 'R28, R36: freezes that can be equipped'),
  ('streak.monthly_freezes', '{"free": 1, "pro": 2}', 'R36: monthly freeze grant'),
  ('game.rest_days_per_week', '1', 'R36: free rest days per calendar week'),
  ('streak.rest_day_plan_ahead_days', '30', 'proposed: how far ahead a rest day can be planned'),
  ('streak.exam_day_protected', 'true', 'me-money §3.5: the exam date pauses the streak like a rest day'),
  ('streak.incident_freeze', 'false', 'R28: on while we have an outage'),
  ('streak.incident_freeze_windows', '[]', 'R28, server only: outage windows as local dates {from, to}; to null while open'),
  -- Plant (R2, R12, R37)
  ('game.plant.stage_days', '[1, 7, 30, 100]', 'R37: study days to reach sprout, sapling, flowering, tree'),
  ('game.plant.health_missed_days', '{"droopy": 1, "dry": 3, "wilted": 7, "dormant": 21}', 'APP_FLOW §3.6: missed days before each health state'),
  ('game.plant.revival_days', '{"droopy": 1, "dry": 2, "wilted": 3, "dormant": 5}', 'R12: study days to revive from each state'),
  -- Pet (me-money §3.3; gains and decay proposed, same defaults as packages/config)
  ('game.pet.start', '{"mood": 80, "energy": 80}', 'DB_SCHEMA game.pets defaults'),
  ('game.pet.decay_per_missed_day', '{"mood": 10, "energy": 10}', 'proposed'),
  ('game.pet.study_gain', '{"mood": 20, "energy": 15}', 'proposed'),
  ('game.pet.state_min_mood', '{"happy": 70, "content": 50, "sleepy": 30, "tired": 15}', 'proposed: mood floor of each pet state'),
  ('game.pet.missing_you_energy_below', '30', 'proposed'),
  ('game.pet.care_mood_cap_per_day', '5', 'me-money §3.3'),
  ('game.pet.pet_mood_gain', '2', 'proposed'),
  ('game.pet.plays_per_day', '3', 'me-money §3.3'),
  ('game.pet.play_energy_gain', '3', 'proposed'),
  ('game.pet.treats_per_day', '1', 'me-money §3.3'),
  ('game.pet.treat_energy_gain', '8', 'proposed'),
  -- XP (proposed; learn flow Q6 leaves the numbers to the gamification owner)
  ('xp.rules', '{"lesson_base": 10, "lesson_per_correct": 2, "lesson_max": 40, "review": 1, "practice_per_correct": 2, "practice_max": 60, "challenge": 15, "mock_section": 20, "hourly_cap": 400}', 'proposed: server XP formula; app-core uses the same numbers'),
  -- Free tier (R16, R25, R35)
  ('free.tutor_messages_per_day', '5', 'R35'),
  ('free.practice_questions_per_day', '30', 'R25'),
  ('free.sectional_mocks_per_week', '1', 'R25'),
  ('free.deep_dive_preview_cards', '4', 'R16'),
  ('free.rotating_chapters', '[]', 'learn G6: chapter ids free this period'),
  ('free.forge_trials_lifetime', '1', 'memory-labs §14 Q2'),
  -- Daily goal (R6)
  ('goal.minutes_options', '[5, 10, 20, 30]', 'R6'),
  ('goal.default_minutes', '10', 'R6'),
  -- Auth (auth flow §10.1; R29 values and proposed defaults)
  ('auth.soft_prompt_cooldown_days', '7', 'R29'),
  ('auth.soft_prompt_later_limit', '2', 'R29'),
  ('auth.soft_prompt_pause_days', '14', 'R29'),
  ('auth.streak_prompt_push', 'false', 'auth §4'),
  ('auth.guardian_consent_gate', '"features"', 'auth §6.10'),
  ('auth.guardian_digilocker', 'false', 'auth §6.10'),
  ('auth.consent_pending_days', '7', 'proposed'),
  ('auth.consent_claim_days', '7', 'proposed'),
  ('auth.consent_handoff_ttl_min', '15', 'proposed'),
  ('auth.consent_link_ttl_h', '72', 'proposed'),
  ('auth.consent_emails_per_day', '3', 'proposed: consent emails to one guardian address a day'),
  ('auth.deletion_grace_days', '7', 'proposed (auth Q5)'),
  ('auth.merge_wait_s', '30', 'proposed'),
  ('auth.merge_retries', '3', 'proposed'),
  ('auth.signin_timeout_s', '15', 'proposed'),
  ('minor.defer_sync_until_consent', 'false', 'onboarding doc'),
  ('merge.keep_guest_pet', 'true', 'auth §6.4 step 7 (owner Q9)'),
  -- Billing and PDF books (proposed starting values for the owner to confirm)
  ('billing.web_grace_days', '7', 'proposed: web (Razorpay) grace after a failed renewal'),
  ('export.books_per_day', '5', 'proposed (me-money §3.9): PDF books a student can make a day'),
  ('export.expiry_days', '30', 'proposed (me-money §3.9): days a PDF book link lasts'),
  -- Social and sharing (R30, R32, R37)
  ('social.duo_max_partners', '5', 'R32'),
  ('share.streak_milestones', '[7, 30, 100]', 'R37 / me-money §3.4'),
  ('league.tier_names', '[{"en":"Seed","hi":"बीज"},{"en":"Sprout","hi":"अंकुर"},{"en":"Leaf","hi":"पत्ती"},{"en":"Bud","hi":"कली"},{"en":"Bloom","hi":"फूल"},{"en":"Lotus","hi":"कमल"},{"en":"Mango","hi":"आम"},{"en":"Neem","hi":"नीम"},{"en":"Peepal","hi":"पीपल"},{"en":"Banyan","hi":"बरगद"}]', 'R30'),
  -- Memory (memory-labs §11)
  ('memory.rescue_cards', '5', 'memory-labs §11'),
  ('memory.session_size', '20', 'memory-labs §11'),
  ('memory.daily_review_cap', '200', 'memory-labs §11'),
  ('memory.new_cards_per_day', '15', 'memory-labs §11'),
  ('memory.leech_lapses', '8', 'memory-labs §11'),
  ('memory.retention_presets', '{"relaxed": 0.85, "standard": 0.90, "exam": 0.95}', 'memory-labs §11'),
  -- Gems (me-money §3.6 starting values)
  ('game.economy.daily_quest_gems', '{"min": 5, "max": 15}', 'me-money §3.6'),
  ('game.economy.weekly_quest_gems', '50', 'me-money §3.6'),
  ('game.economy.badge_gems', '[20, 50, 100]', 'me-money §3.6: by badge tier'),
  ('game.economy.league_promotion_gems', '50', 'me-money §3.6'),
  ('game.economy.streak_milestone_gems', '{"7": 25, "30": 50, "100": 100, "365": 200}', 'me-money §3.6'),
  ('game.economy.first_revival_gems', '50', 'me-money §3.6'),
  ('game.economy.referral_gems', '50', 'me-money §3.6'),
  ('game.shop.treats_max_held', '10', 'me-money §3.6'),
  -- Pricing (PRD §11, R33, R38)
  ('pricing.display', '{"currency": "INR", "pro_monthly_paise": 9900, "intro_paise": 100, "tax_inclusive": true, "yearly_visible": false}', 'R38; the yearly plan stays hidden until its flag is on')
on conflict (key) do nothing;
