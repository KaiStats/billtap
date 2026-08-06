-- Let a restaurant that was created by hand reach its operator.
--
-- ── What is broken ──────────────────────────────────────────────────────────
--
-- Ownership is `restaurants.owner_id`. A row inserted by hand in SQL has none,
-- and migration 0003 — the thing that normally fills it in — cannot help it,
-- for two independent reasons:
--
--   * 0003 only matches rows with a non-null `legacy_owner_id`, which means
--     "came from the Base44 export". A row typed into the SQL editor after the
--     cutover has none, so the trigger skips it and so does 0003's one-time
--     backfill.
--   * The trigger fires AFTER INSERT ON auth.users, i.e. once, at sign-up. An
--     operator who already has an account will never insert again, so even a
--     row that did qualify would not be picked up for them.
--
-- Mariposa is both at once: its row was recreated by hand after the Supabase
-- cutover, and its GM has already signed in. Left alone, saveMyRestaurant sees
-- no row for his owner_id, the dashboard shows him the create form, and he ends
-- up on `mariposa-2` while every printed table tent keeps pointing `/r/mariposa`
-- at the row he no longer owns — ratings and alerts landing on one restaurant
-- while he watches another read zero.
--
-- ── What this changes ───────────────────────────────────────────────────────
--
-- The `legacy_owner_id is not null` condition goes. "Migrated from Base44 and
-- never claimed" narrows to "never claimed", which is the condition that was
-- actually meant: the question is whether a row has an owner, not where it came
-- from.
--
-- That is not a wider grant than 0003 already made. Its trust model is written
-- out at length there and holds unchanged: claiming by email is what magic-link
-- sign-in does by construction, so whoever controls the inbox could hold a
-- session as that address regardless. The blast radius is also unchanged —
-- `owner_id is null` is still the gate, and every row saveMyRestaurant creates
-- sets `owner_id` at creation, so a restaurant that has an owner cannot be
-- taken from them.
--
-- One case does widen, and it is worth naming rather than discovering: owner_id
-- is `on delete set null`, so deleting an operator's auth user returns their
-- restaurant to the claimable pool. That is a manual admin act on an account
-- that no longer exists, and the alternative is a row nobody can ever reach
-- again, so it is the right way round — but it is now reachable by whoever
-- holds the alert_email inbox, which it was not before.
--
-- The Worker does the same match at sign-in (findOrAdoptRestaurant in
-- worker/routes/functions.js), which is what covers operators who already have
-- accounts. This migration is the half that runs for new ones.

-- ── alert_email, folded to lower case ───────────────────────────────────────
--
-- The trigger below compares with lower() on both sides and always has. The
-- Worker cannot afford to: matching case-insensitively from there means either
-- an ilike pattern, where an address containing `%` or `_` quietly matches more
-- rows than it should, or reading every unclaimed restaurant and sifting in the
-- isolate. Both are worse than making the column consistent once.
--
-- restaurantPatch lowercases every alert_email it writes, so this is only the
-- rows that predate it.

update restaurants
set alert_email = lower(alert_email)
where alert_email is not null
  and alert_email <> lower(alert_email);

-- The lookup the Worker's claim path makes on every sign-in that finds no owned
-- row. Small table today; this is here so it stays a lookup.
create index if not exists restaurants_alert_email_idx on restaurants (alert_email);

-- ── The trigger, minus the legacy_owner_id condition ────────────────────────
--
-- Everything else is 0003 unchanged, including `security definer` with a pinned
-- search_path and the exception handler that keeps a bookkeeping step from ever
-- taking down authentication.

create or replace function claim_restaurants_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update restaurants
  set owner_id = new.id
  where owner_id is null
    and alert_email is not null
    and lower(alert_email) = lower(new.email);

  return new;
exception when others then
  raise warning 'claim_restaurants_for_new_user failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

-- ── For operators who already have accounts ─────────────────────────────────
--
-- The trigger only fires on insert. This is the same backfill 0003 runs, with
-- the same condition dropped, and it is what actually reconnects Mariposa the
-- moment this file is applied — the Worker's claim path is the belt to this
-- migration's braces, not a replacement for it.
--
-- Safe to run repeatedly: it only touches rows that are still unclaimed.

update restaurants r
set owner_id = u.id
from auth.users u
where r.owner_id is null
  and r.alert_email is not null
  and lower(u.email) = lower(r.alert_email);

-- ── What is still stranded, and why ─────────────────────────────────────────
--
-- A row whose alert_email is not an address anybody has signed in with. That is
-- the case this cannot fix and should not guess at — it needs someone to decide
-- which account owns it. Mariposa is the one to check first.
--
--   select r.name, r.slug, r.alert_email, r.owner_id is not null as claimed
--   from restaurants r
--   where r.owner_id is null
--   order by r.name;
--
-- To connect one by hand once you know the account:
--
--   update restaurants set owner_id = (select id from auth.users where email = 'gm@example.com')
--   where slug = 'mariposa';
