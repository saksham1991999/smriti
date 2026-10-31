-- 200004: photo doubt (tutor-social §A10, AI-16 to AI-19; R58).
--
-- The app uploads one photo of one question. The API stores it in the private ``uploads`` bucket
-- (``storage_key``), asks the vision tier to read it (AI-18), and keeps the recognised question
-- text so the student can check or edit it. Solving opens a tutor session (mode 'doubt_photo',
-- context_ref 'doubt:{id}'), so the answer streams, counts and is kept like any tutor chat.
-- Photos and their text follow the tutor's retention (ai.tutor_retention_days); a photo rejected
-- as personal (a face or a document) is deleted at once. Written only by the API.
set search_path = public, extensions;

create table ai.doubt_photos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  storage_key      text,                         -- null once the object is deleted
  mime             text not null check (mime in ('image/jpeg','image/png','image/webp')),
  bytes            integer not null check (bytes > 0),
  status           text not null
                     check (status in ('read','unreadable','rejected','solved')),
  -- Why a read failed (AI-18 errors); never free text.
  reason           text check (reason in
                     ('blurry','no_question','multiple','unreadable','not_study','personal','unsafe','ai_unavailable')),
  question_text    text,                         -- the recognised question (LaTeX allowed), editable by the student
  subject          text,
  exam_profile_id  text,
  session_id       uuid references ai.tutor_sessions(id) on delete set null,
  revealed_at      timestamptz,                  -- "Show full solution": hints first until then
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index on ai.doubt_photos (user_id, created_at desc);
create index on ai.doubt_photos (created_at) where storage_key is not null;

comment on table ai.doubt_photos is
  'Photo doubt (AI-16 to AI-19): the uploaded photo''s key and the recognised question.';

-- RLS (DB_SCHEMA §12): the student reads their own rows; no client writes.
grant select, insert, update, delete on ai.doubt_photos to authenticated;
grant all on ai.doubt_photos to service_role;
alter table ai.doubt_photos enable row level security;
create policy owner_read on ai.doubt_photos for select to authenticated
  using (user_id = (select auth.uid()));
