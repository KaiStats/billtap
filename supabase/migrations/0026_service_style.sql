-- How the guest pays: a check at the end, or at the counter before the food.
--
-- ── The hole this closes ────────────────────────────────────────────────────
--
-- Every screen in this product assumes one bill, presented at the end, by a
-- server. `RatingCapture` opens on "I've paid". The table tent says "Split the
-- check". The entry page's first button photographs a bill. Migration 0024
-- widened that by one step — a guest with nothing to split can open a rating
-- from the tent — but the language and the layout still address a table
-- waiting on a check.
--
-- A very large share of the places that would pay for the alert and the review
-- handoff never present a check at all: counter service, coffee, fast casual,
-- bakeries, delis, food trucks, breweries, ghost kitchens, anywhere with a
-- pickup shelf. Their guest pays first, carries their own food, and leaves
-- without anyone ever asking how it was. There is no server to catch a problem
-- at the table, which makes the alert *more* valuable there, not less — and
-- the app was reading them a script written for somebody else's dining room.
--
-- ── Why the payment event cannot be the trigger there ───────────────────────
--
-- This is the whole reason a column exists rather than a copy change. At a
-- table-service restaurant "you have paid" and "you have finished" are the same
-- moment, so hanging the rating off payment is free and correct. At a
-- pay-first counter they are opposite ends of the visit: payment happens
-- *before the first bite*. A rating asked at payment there is a rating of the
-- queue, not the food.
--
-- So for these rooms the trigger has to move off the payment event entirely
-- and onto the guest's own scan of a code placed where finishing happens — the
-- number tent on their table, the cup, the bag, the receipt footer, the bus
-- tub by the door. `service_style` is what tells the app which of the two
-- moments it is living in.
--
-- ── Why a column and not an inference ───────────────────────────────────────
--
-- The argument migrations 0013 and 0024 make. Nothing else on the row can tell
-- these apart: a counter restaurant and a table restaurant with quiet weeks
-- look identical in the data, and "has no split sessions yet" describes every
-- restaurant on its first day. Guessing it would put the wrong screen in front
-- of a guest at the exact moment the operator is paying us to get it right.
--
-- ── What it does and does not decide ────────────────────────────────────────
--
-- It sets the default screen for a bare scan of /r/<slug> — nothing more.
-- Rating-first is also reachable at /r/<slug>/rate for *every* restaurant,
-- because the two styles are not exclusive: a table-service dining room with a
-- takeout window wants the rating sticker on the takeout bag and the split tent
-- on the tables. The path is the explicit request; this column is the default
-- when the guest did not make one.
--
-- Defaulted to 'table' so every existing row keeps meaning what it meant, and
-- every table tent already printed keeps pointing at the screen it was printed
-- for.

alter table restaurants
  add column if not exists service_style text not null default 'table';

-- Checked, not merely defaulted, for the reason 0024 gives: the column outlives
-- any one deploy, and a typo'd style that nothing rejects is a restaurant whose
-- guests get a screen no branch in the app knows how to render.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'restaurants_service_style_check'
  ) then
    alter table restaurants
      add constraint restaurants_service_style_check
      check (service_style in ('table', 'counter'));
  end if;
end $$;
