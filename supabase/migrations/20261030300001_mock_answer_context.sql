-- Mock answers update mastery (sync contract v1.3): when an attempt is submitted the server records
-- each scored answer as a question attempt with context 'mock' and session_id = the attempt id.

alter table learn.question_attempts drop constraint question_attempts_context_check;
alter table learn.question_attempts add constraint question_attempts_context_check
  check (context in ('practice','drill','daily','lesson','duel','pyq','chapter_test','mock'));

-- One mock answer per attempt and question (the sync handler checks this before inserting).
create index question_attempts_mock_idx on learn.question_attempts (user_id, session_id, question_id)
  where context = 'mock';
