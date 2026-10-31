-- PAY-17 remote link (me-money §5.12): the web subscription a parent started from a child's
-- "Send to my parent" link, so verifying it by token finds the right one. billing.payment_links
-- stays service only (RLS on, no policies; DB_SCHEMA §12).
alter table billing.payment_links
  add column subscription_id uuid references billing.subscriptions(id) on delete set null;

-- One open link per learner at a time: a new link cancels the old one.
create index payment_links_open_idx on billing.payment_links (learner_user_id)
  where status = 'open';
