-- 50002: the yearly plan and the family plan (PRD §11.2 "₹799/year", "Family plan for siblings:
-- Phase 3").
--
-- * billing.products.plan tells an individual plan from a family plan. A family product has no
--   price in the row: its price is the owner flag billing.family_{monthly,yearly}_price_paise, and
--   the plan is hidden from /v1/config and checkout while that flag or billing.family_seats is
--   unset. The product rows themselves are in supabase/seed.sql, like the monthly ones.
-- * billing.family_groups: one per paid family subscription; the payer is the owner.
-- * billing.family_members: the people the payer added (seats are people besides the payer).
--   A child joins through the payer's guardian link; an adult joins with an invite code.
-- * billing.family_invites: codes the payer shares; only the sha256 of the code is stored.
-- * billing.entitlements.source gains 'family' (Pro that comes from someone else's family plan).
set search_path = public, extensions;

alter table billing.products
  add column plan text not null default 'individual' check (plan in ('individual','family')),
  alter column price_paise drop not null,
  add constraint products_price_set check (price_paise is not null or plan = 'family');

alter table billing.entitlements drop constraint if exists entitlements_source_check;
alter table billing.entitlements
  add constraint entitlements_source_check
  check (source in ('razorpay','play','app_store','promo','family'));

create table billing.family_groups (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references auth.users(id) on delete cascade,
  subscription_id  uuid not null unique references billing.subscriptions(id) on delete cascade,
  created_at       timestamptz not null default now()
);
create index on billing.family_groups (owner_user_id);

create table billing.family_members (
  group_id    uuid not null references billing.family_groups(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  added_by    uuid references auth.users(id) on delete set null,
  via         text not null check (via in ('guardian_link','invite')),
  joined_at   timestamptz not null default now(),
  removed_at  timestamptz,
  primary key (group_id, user_id)
);
-- One family at a time per person.
create unique index family_members_one_active on billing.family_members (user_id)
  where removed_at is null;

create table billing.family_invites (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references billing.family_groups(id) on delete cascade,
  created_by   uuid not null references auth.users(id) on delete cascade,
  code_hash    text not null unique,
  created_at   timestamptz not null default now(),
  accepted_by  uuid references auth.users(id) on delete set null,
  accepted_at  timestamptz,
  revoked_at   timestamptz
);
create index on billing.family_invites (group_id);

-- RLS (DB_SCHEMA §12): the payer reads the group, its members and its invites; a member reads
-- the group and their own membership. Writes go through the API (service role).
grant select, insert, update, delete on billing.family_groups, billing.family_members,
  billing.family_invites to authenticated;
grant all on billing.family_groups, billing.family_members, billing.family_invites to service_role;

alter table billing.family_groups enable row level security;
create policy owner_or_member_read on billing.family_groups for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or exists (
      select 1 from billing.family_members m
       where m.group_id = family_groups.id and m.user_id = (select auth.uid())
         and m.removed_at is null
    )
  );

alter table billing.family_members enable row level security;
create policy self_or_owner_read on billing.family_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from billing.family_groups g
       where g.id = family_members.group_id and g.owner_user_id = (select auth.uid())
    )
  );

alter table billing.family_invites enable row level security;
create policy owner_read on billing.family_invites for select to authenticated
  using (created_by = (select auth.uid()));
