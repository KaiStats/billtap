-- Reconnect a migrated restaurant to its operator when they first sign in.
--
-- ── The gap this closes ─────────────────────────────────────────────────────
--
-- The data migration deliberately leaves restaurants.owner_id null. Base44's
-- user ids are not uuids and those accounts do not exist in auth.users, so a
-- row carrying one would fail the foreign key and take its whole batch with it.
-- The old id is parked in legacy_owner_id.
--
-- docs/BLUEPRINT-REMOVE-BASE44.md has a one-time UPDATE that rebuilds the link
-- after operators sign in. That is fine for the operators who sign in that
-- week, and wrong for everyone else: an operator who first signs in a month
-- later gets an empty dashboard and no indication why. A trigger has no such
-- window.
--
-- ── The trust model, stated plainly ─────────────────────────────────────────
--
-- This claims a restaurant on the strength of an email address matching
-- alert_email. Whoever controls that inbox becomes the owner.
--
-- That is the same trust model a password reset already has, and the same one
-- the magic-link sign-in has by construction — if you control the inbox you can
-- sign in as that user regardless. So this grants no access that was not
-- already reachable. It is worth being explicit about rather than discovering
-- later.
--
-- Two things keep the blast radius small:
--
--   * Only rows still awaiting their owner are claimable. owner_id must be
--     null AND legacy_owner_id must be non-null — that pair means "migrated
--     from Base44 and never claimed". A restaurant created after the migration
--     has its owner set at creation and can never be taken this way.
--   * The row this claims for is keyed by email, and only whoever opens the
--     emailed link can ever hold a session as it.
--
-- That second point replaces a sentence that said Supabase "only inserts into
-- auth.users after the email is confirmed for magic-link sign-in". That is not
-- what happens: signInWithOtp creates the user row when the link is REQUESTED,
-- with email_confirmed_at still null, and this trigger fires on that insert. So
-- anyone who can type an operator's alert_email into the sign-in form can make
-- the claim happen.
--
-- It is still safe, for a different reason than the one that was written down.
-- Supabase keys users by address, so the row created by that request is the
-- same row the real operator signs in as when they open the link — the claim
-- lands on the person who owns the inbox either way. What an attacker gets for
-- typing the address is the timing, not the account.
--
-- Worth correcting rather than leaving, because the false version is the kind
-- of sentence somebody reasons from later: "confirmed before insert" would
-- justify trusting new.email from a provider where that is not true, and this
-- runs as security definer.
--
-- If a restaurant is ever claimed by the wrong person, the fix is to set
-- owner_id by hand. It does not become unclaimable.

create or replace function claim_restaurants_for_new_user()
returns trigger
language plpgsql
-- security definer because the trigger runs as the auth system inserting into
-- auth.users, which has no rights on public.restaurants.
security definer
-- Pinned, because a security definer function with a caller-controlled
-- search_path is a privilege escalation waiting to be found.
set search_path = public, pg_temp
as $$
begin
  update restaurants
  set owner_id = new.id
  where owner_id is null
    and legacy_owner_id is not null
    and alert_email is not null
    and lower(alert_email) = lower(new.email);

  -- Never block a sign-up. If this fails, the operator still gets an account
  -- and the link can be made by hand; if it raised, they could not sign in at
  -- all — a bookkeeping step taking down authentication.
  return new;
exception when others then
  raise warning 'claim_restaurants_for_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists claim_restaurants_on_signup on auth.users;
create trigger claim_restaurants_on_signup
  after insert on auth.users
  for each row execute function claim_restaurants_for_new_user();

-- ── For operators who already have accounts ─────────────────────────────────
--
-- The trigger only fires on insert, so it does nothing for anyone who signed up
-- before it existed. Safe to run repeatedly: it only touches rows that are
-- still unclaimed.

update restaurants r
set owner_id = u.id
from auth.users u
where r.owner_id is null
  and r.legacy_owner_id is not null
  and r.alert_email is not null
  and lower(u.email) = lower(r.alert_email);

-- ── Who claimed what ────────────────────────────────────────────────────────
--
-- Run this after operators start signing in. A restaurant still showing null
-- has no matching account yet — usually because alert_email differs from the
-- address they signed in with, which is worth knowing before they report an
-- empty dashboard as a bug.
--
--   select name, alert_email, owner_id is not null as claimed, legacy_owner_id
--   from restaurants order by claimed, name;
