-- Mocks (practice §6.10, R26): percentile and rank compare first attempts on the same paper.
-- Published mocks and PYQ papers carry a paper key on the pinned paper; papers built for one
-- student have none and never rank.
create index if not exists mock_attempts_paper_key_idx
  on learn.mock_attempts ((paper ->> 'key'), score desc)
  where attempt_no = 1 and status in ('submitted', 'auto_submitted');
