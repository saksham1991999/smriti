-- Live mocks (Phase 3, practice §6.11, PRD §17).
--
-- ops.live_mock_runs keeps the server's progress through each live mock: when the start signal
-- went out, and when ranks were frozen (after results_at, or window_end when there is none).
-- Ranks and percentiles are written onto the ranked attempts themselves (learn.mock_attempts.rank
-- and .percentile), computed only from first attempts started inside the window; the leaderboard
-- reads them back. Service-only: students see their run through the API.
set search_path = public, extensions;

create table ops.live_mock_runs (
  mock_id            text primary key,
  start_signal_at    timestamptz,
  last_clock_at      timestamptz,
  ranks_published_at timestamptz,
  ranked             integer not null default 0 check (ranked >= 0),
  -- why nothing was ranked: threshold_unset | below_threshold (then ranked = 0)
  unranked_reason    text check (unranked_reason in ('threshold_unset', 'below_threshold')),
  created_at         timestamptz not null default now()
);

alter table ops.live_mock_runs enable row level security;
revoke all on ops.live_mock_runs from authenticated, anon;
grant all on ops.live_mock_runs to service_role;

create index if not exists mock_attempts_live_rank_idx
  on learn.mock_attempts (mock_id, rank) where rank is not null;
create index if not exists mocks_live_window_idx
  on content.mocks (window_start, window_end) where kind = 'live';
