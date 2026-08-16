-- Stripe's half of a person's plan.
--
-- 0016 created profiles with a plan column and no way to buy anything: Pro was
-- granted by hand because there was no consumer checkout. This is what a
-- checkout writes back into.
--
-- ── Why an expiry instead of a status machine ──────────────────────────────
--
-- restaurants carries plan, current_period_end, stripe_customer_id,
-- stripe_subscription_id and a five-state machine in shared/entitlement.js —
-- trial, active, past_due with a grace window, cancelled, and a staleness
-- backstop. That complexity is earned there: $149 a month, a business that
-- stops being able to page its manager, and a real argument about what to do
-- when Stripe's retries are still running.
--
-- None of it is earned at ninety-nine cents. The only thing Pro changes is how
-- many people may join one split, so the worst case of getting it wrong is a
-- party of eleven, and the whole question collapses into one date: is this
-- person paid up right now. `plan_expires_at` is that date. Stripe moves it
-- forward on every renewal and stops moving it when they cancel, so a lapse
-- needs no event to arrive on time — it happens by the clock running out.
--
-- That also makes the failure mode safe. If the webhook stops being delivered
-- entirely, nobody is cut off mid-month and nobody keeps Pro forever: they run
-- to the end of what they paid for and then stop, which is exactly what they
-- bought.

alter table profiles add column if not exists stripe_customer_id     text;
alter table profiles add column if not exists stripe_subscription_id text;

-- Epoch milliseconds, matching restaurants.current_period_end and every other
-- clock in this schema. Null means "no end", which for a hand-granted Pro is
-- correct and deliberate — see resolvePartyLimit.
alter table profiles add column if not exists plan_expires_at bigint;

-- Looked up by the webhook on every subscription event, where the id Stripe
-- sends is the subscription's and not ours. Without this that is a sequential
-- scan of every profile on a path that runs per renewal.
create index if not exists profiles_stripe_subscription
  on profiles (stripe_subscription_id) where stripe_subscription_id is not null;

-- Same, for the customer id: a payment failure names the customer, not the
-- subscription.
create index if not exists profiles_stripe_customer
  on profiles (stripe_customer_id) where stripe_customer_id is not null;

-- ── What is deliberately absent ────────────────────────────────────────────
--
-- No card details, no last four, no brand, no billing address. Stripe holds
-- all of it and this app has no screen that shows any of it. A column here is
-- a column that ends up in the nightly backup, in a restore, and in whatever
-- someone pastes into a support chat.
--
-- restaurants.billing_address exists for a reason that does not apply to a
-- consumer: economic nexus is measured on business customers, and a diner
-- splitting a bill is not one.
