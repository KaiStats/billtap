-- Financial Intelligence: the restaurant's own monthly numbers, beside the
-- guest data BillTap already holds.
--
-- Three things, and the order matters:
--
--   financial_uploads   what the owner handed us (a P&L, payroll export, bank
--                       statement) and what Claude read out of it. Never
--                       trusted on its own: status stays 'extracted' until the
--                       owner has looked at the numbers and confirmed them.
--   monthly_snapshots   the confirmed numbers, one row per restaurant per
--                       month. This is the only table the dashboard and the
--                       combined insights read money from.
--   combined_insights   the month's cross-check of guest data against money:
--                       the facts computed in code, and Claude's write-up of
--                       those facts. Kept so an owner can see what they were
--                       told last month, and so a bad insight can be traced.
--
-- Money is numeric(14,2) in dollars, not floating point. Months are the first
-- day of the month as a date. Every other timestamp is epoch ms (bigint), like
-- the rest of this schema.
--
-- RLS is on and there are no policies: the browser never reads these tables
-- directly. Everything goes through the Worker, which checks the caller owns
-- the restaurant — the same arrangement as guest_ratings.
--
-- Idempotent, like every migration here: safe to paste twice.

-- Which modules a restaurant has switched on. Guest Recovery is what every
-- existing restaurant already has, so it is the default; finance is added per
-- restaurant until it has a price.
alter table restaurants add column if not exists modules text[] not null default '{guest_recovery}';

create table if not exists financial_uploads (
  id             text primary key default billtap_id(),
  restaurant_id  text not null references restaurants(id) on delete cascade,
  -- Key inside the private finance-uploads bucket. Null if the store failed;
  -- the extraction still stands without it.
  storage_key    text,
  file_name      text not null,
  media_type     text not null,
  size_bytes     integer not null check (size_bytes > 0),
  -- The owner's pick, used to steer extraction. 'other' is allowed.
  kind           text not null check (kind in ('pnl', 'payroll', 'bank', 'sales', 'other')),
  status         text not null default 'extracted'
                 check (status in ('extracted', 'confirmed', 'failed', 'discarded')),
  -- Claude's structured read of the document. See shared/finance.js for shape.
  extracted      jsonb,
  error          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     bigint not null,
  created_date   timestamptz not null default now()
);
create index if not exists financial_uploads_restaurant on financial_uploads (restaurant_id, created_at desc);

create table if not exists monthly_snapshots (
  id                 text primary key default billtap_id(),
  restaurant_id      text not null references restaurants(id) on delete cascade,
  month              date not null check (extract(day from month) = 1),
  revenue            numeric(14,2) check (revenue is null or revenue >= 0),
  food_cost          numeric(14,2) check (food_cost is null or food_cost >= 0),
  beverage_cost      numeric(14,2) check (beverage_cost is null or beverage_cost >= 0),
  labor_cost         numeric(14,2) check (labor_cost is null or labor_cost >= 0),
  occupancy_cost     numeric(14,2) check (occupancy_cost is null or occupancy_cost >= 0),
  marketing_cost     numeric(14,2) check (marketing_cost is null or marketing_cost >= 0),
  other_operating    numeric(14,2) check (other_operating is null or other_operating >= 0),
  -- Can be negative: a loss is a number an owner needs to see.
  net_income         numeric(14,2),
  covers             integer check (covers is null or covers >= 0),
  source_upload_ids  text[] not null default '{}',
  notes              text,
  confirmed_by       uuid references auth.users(id) on delete set null,
  confirmed_at       bigint not null,
  created_date       timestamptz not null default now(),
  updated_date       timestamptz not null default now(),
  unique (restaurant_id, month)
);

create table if not exists combined_insights (
  id             text primary key default billtap_id(),
  restaurant_id  text not null references restaurants(id) on delete cascade,
  month          date not null check (extract(day from month) = 1),
  -- Everything the narrative was allowed to use, computed in code.
  facts          jsonb not null,
  -- [{ title, body, fact_keys[] }] — each insight names the facts it rests on.
  insights       jsonb not null,
  model          text not null,
  created_at     bigint not null,
  created_date   timestamptz not null default now()
);
create index if not exists combined_insights_restaurant on combined_insights (restaurant_id, month desc, created_at desc);

alter table financial_uploads  enable row level security;
alter table monthly_snapshots  enable row level security;
alter table combined_insights  enable row level security;

-- Private. Unlike receipts there is no anon insert: uploads go through the
-- Worker, which checks ownership and caps the size before anything is stored.
insert into storage.buckets (id, name, public, file_size_limit)
values ('finance-uploads', 'finance-uploads', false, 10485760)
on conflict (id) do nothing;
