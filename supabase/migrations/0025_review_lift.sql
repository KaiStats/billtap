-- What the restaurant's Google listing looked like when they signed up, and now.
--
-- ── The question this answers ───────────────────────────────────────────────
--
-- At renewal a GM asks one thing: "my reviews were 89 when I started paying —
-- what are they now?" Nothing in this product could answer it.
--
-- `guest_ratings.routed_to_google` counts the guests who *tapped* the review
-- button. That is an activity metric: it says the app did its job, not that the
-- restaurant got anything. A month-three conversation that opens with "we sent
-- 47 people to your review page" is asking the operator to take the outcome on
-- faith, and $149 a month against a slow week loses that argument.
--
-- ── Why two pairs of columns ────────────────────────────────────────────────
--
-- The delta is the product. A current count alone says nothing — 134 reviews
-- is meaningless without knowing it was 89 in August — so the starting point
-- has to be captured once and then left alone. Hence a baseline pair that is
-- written on the first reading and never moved, and a current pair that is
-- overwritten as often as anyone likes.
--
-- The baseline is set from the first current value rather than being asked for
-- separately: an operator typing their review count into settings should not
-- also have to understand what a baseline is. First write fills both; every
-- write after that moves only the current. See restaurantPatch in
-- worker/routes/functions.js.
--
-- ── Why this is not the Google Business Profile API ─────────────────────────
--
-- It should be, eventually. Reading totalReviewCount and averageRating from
-- Google directly is the version that keeps itself honest, and it needs the
-- owner to OAuth-connect their profile plus Google's own API approval — real
-- work, and not a reason to have no answer in the meantime.
--
-- These columns are deliberately indifferent to where the number came from.
-- A human typing it in settings today and a nightly job writing it from the
-- API later fill exactly the same fields, and the dashboard that reads them
-- does not change. `google_reviews_at` is what makes a hand-entered figure
-- honest: the screen can say how old the number is instead of implying it is
-- live.
--
-- Nullable throughout, and no backfill. A restaurant that has never entered a
-- count has no lift to show, and inventing a zero baseline would report every
-- existing review as though BillTap had produced it.

alter table restaurants
  add column if not exists google_review_count       integer,
  add column if not exists google_rating             numeric(2,1),
  add column if not exists google_reviews_at         bigint,
  add column if not exists google_review_count_start integer,
  add column if not exists google_rating_start       numeric(2,1),
  add column if not exists google_baseline_at        bigint;

-- Sanity bounds, because these are typed in by hand and a fat-fingered rating
-- of 45 would render as a lift no restaurant has ever had. Checked here as
-- well as in the Worker for the reason 0024 gives: the column outlives any one
-- deploy.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_google_rating_range') then
    alter table restaurants add constraint restaurants_google_rating_range
      check (
        (google_rating is null or (google_rating >= 0 and google_rating <= 5))
        and (google_rating_start is null or (google_rating_start >= 0 and google_rating_start <= 5))
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'restaurants_google_counts_nonneg') then
    alter table restaurants add constraint restaurants_google_counts_nonneg
      check (
        (google_review_count is null or google_review_count >= 0)
        and (google_review_count_start is null or google_review_count_start >= 0)
      );
  end if;
end $$;
