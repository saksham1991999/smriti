-- 0002: the content catalogue (DB_SCHEMA §4). A projection of content/ written only by the
-- content-publish job (service role).
set search_path = public, extensions;

-- 4.1 Exams, profiles and blueprints
create table content.exams (
  id               text primary key,
  name             i18n_text not null,
  category         text not null check (category in
                     ('engineering','medical','civil_services','ssc','banking','railways','defence','state','school')),
  conducting_body  text,
  official_url     text,
  is_active        boolean not null default true
);

create table content.exam_profiles (
  id            text primary key,
  exam_id       text not null references content.exams(id),
  cycle         text not null,
  name          i18n_text not null,
  locales       text[] not null default '{en,hi}',
  schedule      jsonb,
  is_active     boolean not null default true,
  published_at  timestamptz
);

create table content.exam_blueprints (
  id               uuid primary key default gen_random_uuid(),
  exam_profile_id  text not null references content.exam_profiles(id),
  paper_code       text not null,
  version          integer not null,
  spec             jsonb not null,
  source_url       text not null,
  verified_at      date not null,
  effective_from   date not null,
  status           text not null check (status in ('draft','active','retired')),
  unique (exam_profile_id, paper_code, version)
);

-- 4.2 The concept graph
create table content.subjects (
  id            text primary key,
  name          i18n_text not null,
  color_token   text not null,
  icon_asset_id uuid,
  sort          smallint not null
);

create table content.units (
  id text primary key,
  subject_id text not null references content.subjects(id),
  name i18n_text not null,
  sort smallint not null
);

create table content.chapters (
  id          text primary key,
  unit_id     text not null references content.units(id),
  subject_id  text not null references content.subjects(id),
  name        i18n_text not null,
  ncert_ref   text,
  sort        smallint not null
);
create index on content.chapters (subject_id, sort);

create table content.topics (
  id          text primary key,
  chapter_id  text not null references content.chapters(id),
  name        i18n_text not null,
  summary     i18n_text,
  sort        smallint not null
);
create index on content.topics (chapter_id, sort);

create table content.subtopics (
  id text primary key,
  topic_id text not null references content.topics(id),
  name i18n_text not null,
  sort smallint not null
);
create index on content.subtopics (topic_id);

create table content.concepts (
  id            text primary key,
  subtopic_id   text not null references content.subtopics(id),
  name          i18n_text not null,
  summary       i18n_text not null,
  key_points    jsonb not null default '[]',
  kind          text not null check (kind in
                  ('fact','definition','formula','derivation','process','skill','date','list','diagram')),
  intrinsic_depth smallint not null check (intrinsic_depth between 1 and 5),
  sort          smallint not null
);
create index on content.concepts (subtopic_id);

create table content.concept_edges (
  from_id  text not null references content.concepts(id),
  to_id    text not null references content.concepts(id),
  kind     text not null check (kind in ('prerequisite','related','contrast','applies_in')),
  primary key (from_id, to_id, kind)
);

create table content.exam_concepts (
  exam_profile_id text not null references content.exam_profiles(id),
  concept_id      text not null references content.concepts(id),
  depth           smallint not null check (depth between 1 and 5),
  weightage       numeric(5,2),
  priority        text not null default 'core' check (priority in ('core','high_yield','optional')),
  primary key (exam_profile_id, concept_id)
);
create index on content.exam_concepts (concept_id);

-- 4.3 Content items, versions, bundles and manifests
create table content.content_items (
  id              text primary key,
  kind            text not null check (kind in
                    ('lesson','flashcard_set','mnemonic','cheat_sheet','revision_sheet','storybook',
                     'sim','model3d','pano360','video','experiment','mind_map_template')),
  topic_id        text references content.topics(id),
  mode            text check (mode in ('deep_dive','quick_revision')),
  status          text not null check (status in ('draft','review','published','retired')),
  current_version integer not null default 1,
  is_free         boolean not null default false,
  source_path     text not null,
  updated_at      timestamptz not null default now()
);
create index on content.content_items (topic_id);
create trigger content_items_touch before update on content.content_items
  for each row execute function app.touch_updated_at();

create table content.content_item_concepts (
  item_id    text not null references content.content_items(id),
  concept_id text not null references content.concepts(id),
  role       text not null check (role in ('teaches','revises','tests','mentions')),
  primary key (item_id, concept_id, role)
);

create table content.content_versions (
  item_id         text not null references content.content_items(id),
  version         integer not null,
  locale          text not null,
  content_hash    text not null,
  schema_version  smallint not null,
  changelog       text,
  published_at    timestamptz not null default now(),
  primary key (item_id, version, locale)
);

create table content.bundles (
  id               text primary key,
  topic_id         text not null references content.topics(id),
  mode             text not null,
  locale           text not null,
  hash             text not null,
  size_bytes       integer not null,
  card_count       smallint not null,
  min_app_version  text not null,
  published_at     timestamptz not null default now()
);
create index on content.bundles (topic_id);

create table content.bundle_history (
  bundle_id     text not null references content.bundles(id),
  hash          text not null,
  published_at  timestamptz not null,
  primary key (bundle_id, hash)
);

create table content.bundle_patches (
  bundle_id   text not null references content.bundles(id),
  from_hash   text not null,
  to_hash     text not null,
  size_bytes  integer not null,
  primary key (bundle_id, from_hash, to_hash)
);

create table content.manifests (
  exam_profile_id text not null references content.exam_profiles(id),
  locale          text not null,
  version         integer not null,
  hash            text not null,
  is_current      boolean not null default false,
  published_at    timestamptz not null default now(),
  primary key (exam_profile_id, locale, version)
);
create unique index on content.manifests (exam_profile_id, locale) where is_current;

create table content.seed_packs (
  variant_id   text not null,
  locale       text not null,
  bundle_ids   text[] not null,
  hash         text not null,
  built_at     timestamptz not null default now(),
  primary key (variant_id, locale)
);

-- 4.4 Questions, PYQs and mocks
create table content.questions (
  id               text primary key,
  type             text not null check (type in
                     ('mcq_single','mcq_multi','numerical','integer','matrix_match','match_list',
                      'assertion_reason','statement_based','paragraph','fill_blank','order_steps')),
  locales          text[] not null,
  difficulty       numeric(4,2),
  discrimination   numeric(4,2),
  difficulty_label text check (difficulty_label in ('easy','medium','hard')),
  ideal_time_s     smallint,
  source           text not null check (source in ('original','pyq','ncert_exemplar','adapted')),
  status           text not null check (status in ('draft','review','published','retired')),
  version          integer not null default 1,
  bundle_ref       text,
  search           tsvector
);
create index on content.questions using gin (search);

create table content.question_keys (
  question_id  text primary key references content.questions(id),
  answer       jsonb not null,
  partial_rule jsonb
);

create table content.question_concepts (
  question_id text not null references content.questions(id),
  concept_id  text not null references content.concepts(id),
  weight      numeric(3,2) not null default 1,
  primary key (question_id, concept_id)
);
create index on content.question_concepts (concept_id);

create table content.pyq_papers (
  id            text primary key,
  exam_id       text not null references content.exams(id),
  year          smallint not null,
  session_label text,
  held_on       date,
  paper_code    text,
  blueprint_id  uuid references content.exam_blueprints(id),
  source_url    text,
  notes         text
);

create table content.pyq_questions (
  paper_id     text not null references content.pyq_papers(id),
  number       smallint not null,
  question_id  text not null references content.questions(id),
  primary key (paper_id, number)
);

create table content.mocks (
  id               text primary key,
  exam_profile_id  text not null references content.exam_profiles(id),
  blueprint_id     uuid not null references content.exam_blueprints(id),
  kind             text not null check (kind in ('full','sectional','chapter','pyq_paper','live')),
  title            i18n_text not null,
  is_free          boolean not null default false,
  window_start     timestamptz,
  window_end       timestamptz,
  results_at       timestamptz,
  group_id         text,
  group_order      smallint,
  status           text not null check (status in ('draft','scheduled','open','closed','retired'))
);

create table content.mock_items (
  mock_id       text not null references content.mocks(id),
  section_code  text not null,
  position      smallint not null,
  question_id   text not null references content.questions(id),
  marking       jsonb,
  primary key (mock_id, section_code, position)
);

-- 4.5 Media, the image index, sims and videos
create table content.media_assets (
  id             uuid primary key default gen_random_uuid(),
  sha256         text not null unique,
  kind           text not null check (kind in
                   ('image','audio','model3d','pano360','lottie','rive','video_clip','svg')),
  mime           text not null,
  bytes          integer not null,
  width          smallint, height smallint, duration_ms integer,
  variants       jsonb not null default '{}',
  source         text not null check (source in ('agnes','deepgram_tts','open_licence','original','user_upload')),
  licence        text,
  attribution    text,
  prompt         text,
  prompt_hash    text,
  style_preset   text,
  model_version  text,
  alt            i18n_text,
  tags           text[] not null default '{}',
  visibility     text not null default 'public' check (visibility in ('public','private')),
  owner_user_id  uuid references auth.users(id) on delete cascade,
  status         text not null check (status in ('staging','approved','rejected')),
  created_at     timestamptz not null default now()
);
create unique index on content.media_assets (prompt_hash) where prompt_hash is not null and visibility = 'public';
create index on content.media_assets using gin (tags);
select ops.if_vector($v$alter table content.media_assets add column embedding vector(768)$v$,
                     'content.media_assets.embedding');
select ops.if_vector($v$create index media_assets_embedding_hnsw on content.media_assets
                        using hnsw (embedding vector_cosine_ops) where status = 'approved'$v$,
                     'content.media_assets HNSW index');

create table content.sims (
  id              text primary key,
  version         text not null,
  r2_prefix       text not null,
  origin          text not null check (origin in ('own','phet','other_open')),
  licence         text not null,
  attribution     text,
  params_schema   jsonb not null default '{}',
  size_bytes      integer not null,
  status          text not null check (status in ('draft','published','retired'))
);

create table content.videos (
  youtube_id      text primary key,
  playlist_id     text,
  title           i18n_text not null,
  duration_s      integer,
  topic_id        text references content.topics(id),
  transcript_key  text,
  published_at    timestamptz
);

-- 4.6 Search and community mnemonics
create table content.search_docs (
  id               text primary key,
  ref_kind         text not null,
  ref_id           text not null,
  locale           text not null,
  exam_profile_ids text[] not null,
  title            text not null,
  body             text not null,
  tsv              tsvector not null
);
create index on content.search_docs using gin (tsv);
create index on content.search_docs using gin (title gin_trgm_ops);
create index on content.search_docs using gin (exam_profile_ids);
select ops.if_vector($v$alter table content.search_docs add column embedding vector(768)$v$,
                     'content.search_docs.embedding');
select ops.if_vector($v$create index search_docs_embedding_hnsw on content.search_docs
                        using hnsw (embedding vector_cosine_ops)$v$,
                     'content.search_docs HNSW index');

create table content.mnemonics (
  id           uuid primary key default gen_random_uuid(),
  concept_id   text not null references content.concepts(id),
  technique    text not null check (technique in
                 ('acronym','acrostic','story','rhyme','song','keyword','pao','major_system',
                  'peg','palace','chunking','visual')),
  locale       text not null,
  body         text not null,
  audio_asset_id uuid references content.media_assets(id),
  image_asset_id uuid references content.media_assets(id),
  exam_style   text,
  origin       text not null check (origin in ('traditional','system','community')),
  submitted_by uuid references auth.users(id) on delete set null,
  source_user_mnemonic_id uuid,
  votes        integer not null default 0,
  status       text not null check (status in ('review','published','retired'))
);
create index on content.mnemonics (concept_id, locale) where status = 'published';

create table content.mnemonic_votes (
  mnemonic_id  uuid not null references content.mnemonics(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (mnemonic_id, user_id)
);
create index on content.mnemonic_votes (user_id);
