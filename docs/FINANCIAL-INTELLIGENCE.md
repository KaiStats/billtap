# Financial Intelligence

The second module in the restaurant dashboard, beside Guest Recovery. An owner
uploads a month's P&L, payroll or bank file; Claude drafts the figures; the
owner checks and confirms them; the dashboard shows the standard ratios and a
short monthly briefing that sets the money beside the guest ratings.

Off for every restaurant until switched on. With it off, the dashboard is
exactly what it was.

## Pieces

| Layer | File | What it does |
| --- | --- | --- |
| Schema | `supabase/migrations/0028_financial_intelligence.sql` | `restaurants.modules`, `financial_uploads`, `monthly_snapshots`, `combined_insights`, private `finance-uploads` bucket. RLS on, no policies: Worker only. |
| Arithmetic | `shared/finance.js` | Snapshot validation, ratios (prime cost, labor %, margin), guest numbers per month, the fact list for insights. Used by Worker and browser. |
| Claude | `worker/lib/claude.js` | `readFinancialDocument` (PDF/CSV → draft figures, structured output) and `writeCombinedInsights` (facts → 2–4 cited observations). `claude-opus-5-5`, refusal fallbacks on. |
| Endpoints | `worker/routes/finance.js` | `getFinanceData`, `uploadFinancialDocument`, `saveMonthlySnapshot`, `generateCombinedInsights` at `/api/fn/<name>`. Owner-only, module-gated. Upload and insights are on the costly rate limit. |
| UI | `src/components/FinanceModule.jsx` | Overview and Finances tabs in `/restaurant-dashboard`. |
| Tests | `worker/finance.test.mjs` | Ratios, month bounds, fact citations, ownership and module gates, the upload path with Claude stubbed. |

## Rules the design keeps

- **Claude never does the sums.** It reads documents into a draft and writes
  sentences. Every number on screen comes from `shared/finance.js` over months
  the owner confirmed.
- **Nothing is saved as the owner's numbers until they confirm it.** An upload
  sits at `extracted` until then.
- **Insights cite facts.** Each one names the fact keys it rests on, and any
  insight citing a key that does not exist is dropped before it is stored.
- **Same month, not cause.** The prompt forbids causal claims across guest and
  money data.
- **No claims the data cannot support.** BillTap does not know what an
  individual table spent, or labor by day of the week, so nothing compares
  them.

## Plans

| Plan | Price | Modules | Worker binding |
| --- | --- | --- | --- |
| Guest Recovery | $149/mo | guest_recovery | `STRIPE_PRICE_ID` (unchanged) |
| Financial Intelligence | $249/mo | finance | `STRIPE_FINANCE_PRICE_ID` |
| Full platform | $349/mo | guest_recovery + finance | `STRIPE_PLATFORM_PRICE_ID` |

`create-checkout` takes `tier` (default `guest_recovery`) and stamps it on the
subscription's metadata; `verify-checkout` and the Stripe webhook set
`restaurants.modules` from it while the subscription is paying. Every
restaurant gets the same 30-day trial as before, and a restaurant still on its
trial can switch Finance on from the dashboard (`startFinanceTrial`). A paying
$149 restaurant changes plan through the founder for now: there is no
self-serve plan change on an existing subscription yet.

Finance is also gated on entitlement: a lapsed restaurant keeps its rows but
cannot read or add to them until it resubscribes.

## Files and retention

- Owners can delete any uploaded file from the Finances tab. The confirmed
  figures stay.
- The nightly retention job deletes original files after 90 days
  (`FINANCE_FILE_RETENTION_DAYS`). Rows keep their extracted draft.
- When an expired demo restaurant is swept, its files are deleted first.

## Documents

- PDF, CSV and Excel (`.xlsx`). Excel is converted to CSV in the browser
  (`src/lib/excelToCsv.js`, every sheet kept) before upload.
- Several documents per month: the review form takes more files and merges
  them (`mergeDrafts`): payroll is trusted first for labor, POS sales for
  revenue, the P&L for everything else. Anything the owner typed is never
  overwritten, and a file for a different month is shown, not mixed in.

## Monthly email

Restaurants with Finance get a section in the 1st-of-the-month report: the
latest confirmed month's revenue, prime cost, labor and margin, plus that
month's stored insights. The cron makes no new model calls.

## Turning it on

1. Run `0028_financial_intelligence.sql` in the Supabase SQL editor (staging
   first).
2. Worker secrets (and the same with `--env staging`):
   ```
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put STRIPE_FINANCE_PRICE_ID
   npx wrangler secret put STRIPE_PLATFORM_PRICE_ID
   ```
   Optional: `CLAUDE_MODEL` to override `claude-opus-5-5`.
3. Deploy (Actions → Deploy).
4. To switch a restaurant on by hand:
   ```sql
   update restaurants
   set modules = array['guest_recovery', 'finance']
   where slug = '<slug>';
   ```

Without the API key, uploads answer "not set up yet" and owners can still enter
months by hand.

## Still open

- Self-serve plan changes for restaurants already paying (upgrade from $149
  to $349 inside Stripe).
- The public /restaurants page still sells only the $149 plan.
- Excel's older `.xls` format is not read; owners save as `.xlsx` or CSV.
