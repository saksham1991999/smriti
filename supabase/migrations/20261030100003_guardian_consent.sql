-- Guardian consent for 13 to 17 (auth flow §6.10, DPDP s.9, AGENTS rule 8).
--
-- 1. A consent request can be delivered by email as well as by the teen sharing the link. Only an
--    HMAC of the guardian's email is kept (to rate-limit repeat sends); the address itself is
--    used once, to send the mail, and never stored.
-- 2. The consent state on the profile follows the age band: a teen needs consent, an adult does
--    not. The trigger covers every path that changes the band (onboarding answers, the turning-18
--    job, a merge), so no code path can forget it.

alter table app.guardian_consent_requests
  add column delivery            text not null default 'share' check (delivery in ('share','email')),
  add column guardian_email_hash text,
  add column delivered_at        timestamptz,
  add column locale              text not null default 'en' check (locale in ('en','hi')),
  add column app_variant         text;

comment on column app.guardian_consent_requests.guardian_email_hash is
  'HMAC-SHA256 of the lower-cased guardian email (AUTH_IDENTITY_HASH_PEPPER). The email is never stored.';

create index on app.guardian_consent_requests (status, expires_at) where status = 'pending';

alter table app.guardian_consents
  add column revoked_by text check (revoked_by in ('guardian','learner','system','turned_18'));

create or replace function app.sync_consent_state() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.age_band is distinct from old.age_band then
    if new.age_band = '18p' then
      -- An adult needs no consent. The consent rows stay as history (and evidence).
      new.guardian_consent_state := 'not_required';
    elsif new.age_band in ('u10','10_12','13_17') then
      if new.guardian_consent_state = 'not_required' then
        new.guardian_consent_state := 'required';
      end if;
    end if;
  end if;
  return new;
end
$$;

create trigger profiles_consent_state before update of age_band on app.profiles
  for each row execute function app.sync_consent_state();

-- Profiles that already have a minor band (created before this migration) need consent too.
update app.profiles set guardian_consent_state = 'required'
 where age_band in ('u10','10_12','13_17') and guardian_consent_state = 'not_required';
