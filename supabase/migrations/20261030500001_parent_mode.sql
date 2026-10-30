-- 50001: Parent mode, Phase 3 (me-money §4.7 SET-13 to SET-19, §10 "Parent links, limits, time
-- requests"; tutor-social B13 for the parent friends list).
--
-- app.parental_controls and app.time_requests exist since 0003 with the guardian-or-learner read
-- RLS of 0009. This adds what the parent dashboard sets and the server enforces:
--   * social on/off and tutor on/off per child (the gates in social_people and tutor read them);
--   * the weekly report switch, per guardian and child ("Weekly email report", SET-14);
--   * which local day a time request is for, and who decided it (SET-19 "Ask for 15 more
--     minutes": an approval extends that day's limit only).
-- Writes go through the API (service role). Nothing here is typed by the child.
set search_path = public, extensions;

alter table app.parental_controls
  add column social_enabled boolean not null default true,
  add column tutor_enabled  boolean not null default true,
  add constraint parental_controls_hours_pair
    check ((allowed_from is null) = (allowed_to is null));

comment on column app.parental_controls.tutor_button is
  'Little learners (u10): the preset-question tutor button, off until the parent turns it on (R14).';
comment on column app.parental_controls.tutor_enabled is
  'Older children: the parent can turn the AI tutor off. Enforced by the tutor gate.';
comment on column app.parental_controls.social_enabled is
  'The parent can turn friends, duels and other social features off. Enforced by the social gate.';

alter table app.guardian_links
  add column weekly_report boolean not null default true;

-- guardian_user_id (0003) stays null while the ask is open (every linked guardian sees it) and
-- records the guardian who allowed or declined it.
alter table app.time_requests
  add column for_date date,
  add constraint time_requests_minutes check (minutes between 1 and 120);

update app.time_requests set for_date = (created_at at time zone 'Asia/Kolkata')::date
 where for_date is null;
alter table app.time_requests alter column for_date set not null;

-- One open ask at a time per child.
create unique index time_requests_one_pending on app.time_requests (learner_user_id)
  where status = 'pending';
