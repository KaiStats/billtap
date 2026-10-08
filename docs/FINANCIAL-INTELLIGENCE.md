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

## Turning it on

1. Run `0028_financial_intelligence.sql` in the Supabase SQL editor (staging
   first).
2. `npx wrangler secret put ANTHROPIC_API_KEY` (and `--env staging`).
   Optional: `CLAUDE_MODEL` to override `claude-opus-5-5`.
3. Deploy (Actions → Deploy).
4. Switch a restaurant on:
   ```sql
   update restaurants
   set modules = array['guest_recovery', 'finance']
   where slug = '<slug>';
   ```

Without the API key, uploads answer "not set up yet" and owners can still enter
months by hand.

## Not built yet

- **Pricing and billing.** There is no Stripe price for the finance module or
  the bundle. The module is switched on by hand until one exists.
- **Excel files.** PDF and CSV only; the upload screen tells owners to save
  Excel as CSV.
- **Several documents per month.** One upload pre-fills the form; to combine a
  P&L with a payroll report, the owner types the second figure in.
- **Insights in the monthly email.** The report still covers guest data only.
- **Deleting uploads.** Files stay in the private bucket; there is no
  owner-facing delete or retention job for them yet.
