-- Guest recovery: what went wrong, and what the manager did about it.
--
-- A low rating already pages the operator with the table and the guest's own
-- words. What it never recorded is the rest of the story: which kind of
-- problem it was, and whether anyone walked over. Without that, the monthly
-- report can say "3 low ratings" but not "slow service, twice, both on
-- Friday — and you recovered one of them", which is the number an owner can
-- actually manage.
--
-- issue            the guest's own pick on "What went wrong?" — optional, the
--                  free-text comment stays the primary record.
-- recovery_status  set by the operator from the dashboard: 'handling' when
--                  someone claims it, then an outcome. Null means nobody did.
-- recovery_*_at    epoch ms, like every other timestamp on this table.
--
-- Values are checked here as well as in shared/guest-recovery.js, for the
-- reason 0026 gives: the column outlives any one deploy.

alter table guest_ratings add column if not exists issue text;
alter table guest_ratings add column if not exists recovery_status text;
alter table guest_ratings add column if not exists recovery_claimed_at bigint;
alter table guest_ratings add column if not exists recovery_updated_at bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'guest_ratings_issue_check') then
    alter table guest_ratings add constraint guest_ratings_issue_check
      check (issue is null or issue in
        ('slow_service', 'food_quality', 'order_wrong', 'staff', 'cleanliness', 'billing', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guest_ratings_recovery_status_check') then
    alter table guest_ratings add constraint guest_ratings_recovery_status_check
      check (recovery_status is null or recovery_status in
        ('handling', 'recovered', 'partial', 'not_recovered', 'guest_left', 'follow_up'));
  end if;
end $$;
