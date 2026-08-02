# Finishing the move off Base44

Every step, in order, with what you should see and when to stop.

Run each command on its own line. Do not paste a block. If a step does not
produce what it says it should, stop there and say so — every one of these is
reversible up to step 7, and step 7 is reversible in under a minute.

**Where you are:** `~/scan-repo/billtap`

---

## Before anything

```
cd ~/scan-repo/billtap
```
```
git pull origin main
```
```
npm test
```

You want **398 pass, 0 fail**. If not, stop.

---

## 1 — Rotate the Supabase keys (2 min)

These go first because nothing in production uses them yet, so rotating now
costs nothing. The Base44 key is different and comes last — see step 9.

Supabase dashboard → **Project Settings → API keys**

1. Roll the **anon** key.
2. Roll the **service_role** key.

Then, in the terminal, using the *new* values:

```
export SUPABASE_URL=https://skrqxxhoxbrvlviqrhjt.supabase.co
```
```
export SUPABASE_SERVICE_ROLE_KEY=PASTE_THE_NEW_SERVICE_ROLE_KEY
```

The migration script decodes that key and refuses if it is the anon key, so a
wrong paste stops here rather than as an unexplained 401 later.

---

## 2 — Create the tables (3 min)

Supabase dashboard → **SQL Editor** → New query.

Two files, in this order. Paste the whole contents of each and press Run.

1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_audit_log.sql`

Check it worked. Paste this into the SQL editor:

```sql
select table_name from information_schema.tables
where table_schema = 'public' order by 1;
```

**You want eight rows:** `audit_log`, `guest_contacts`, `guest_ratings`,
`receipts`, `restaurant_leads`, `restaurants`, `sessions`, `waitlist`.

Fewer than eight means one of the two files did not finish. Run it again — both
are safe to re-run.

---

## 3 — Export the data from your browser (5 min)

Base44's server API ignores the master key: it answers `200` and an empty array
to any credential and to none. Your browser is the one place a credential works,
because that is what the app itself uses.

1. Open **https://billtap.app** and sign in as the account that owns the
   restaurants. It has to be that account — you can only export what you can
   read.
2. Open the console: **Cmd + Option + J**.
3. Open `scripts/export-from-browser.js`, copy the whole file, paste it into the
   console, press Enter.

It prints a count per entity and downloads `base44-export.json`.

**Read the Restaurant count.** Those are paying customers. If it is zero here
too — with a credential the app uses every day — then the data genuinely is not
in Base44, there is nothing to migrate, and you can skip to step 5. That is a
real answer, not a failure.

---

## 4 — Copy it into Supabase (3 min)

Dry run first. It writes nothing.

```
node scripts/migrate-to-supabase.mjs --from-file ~/Downloads/base44-export.json --dry-run
```

**Read the output.** It prints a row count per table, and any Base44 field with
no column here — those are dropped. If something on that list matters, stop and
say so; adding a column afterwards means re-running the migration.

Then for real:

```
node scripts/migrate-to-supabase.mjs --from-file ~/Downloads/base44-export.json
```

It is idempotent, so running it twice is safe. It exits non-zero and says
**DO NOT CUT OVER** if any table received fewer rows than it read. Believe it.

Check it landed, in the SQL editor:

```sql
select id, title, status, host_key_hash is not null as has_host_key,
       jsonb_array_length(items) as items,
       jsonb_array_length(participants) as people
from sessions order by created_date desc limit 10;
```

`has_host_key` must be **true** on rows that had one. Without it nobody can
confirm a payment on that split again.

---

## 5 — Give the Worker its credentials (5 min)

Four secrets. Each command prompts for a value — paste it and press Enter.

```
npx wrangler secret put SUPABASE_URL
```
```
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```
```
npx wrangler secret put SUPABASE_ANON_KEY
```
```
npx wrangler secret put GEMINI_API_KEY
```

The last one turns on the direct receipt scan — the path that measured 5465ms →
2879ms. It is already written and has been waiting on this key.

The service role key bypasses row-level security entirely. It belongs in the
Worker and **nowhere near the browser bundle** — anything prefixed `VITE_` is
public.

---

## 6 — Set the build variable (2 min)

Cloudflare dashboard → your Worker → **Settings → Variables and Secrets** →
Build variables.

```
VITE_ENVIRONMENT = production
```

The build refuses without it, on purpose: a bundle that does not know which
environment it is cannot show the environment badge, and a staging build that
looks like production is how someone writes into a live restaurant's bills.

---

## 7 — Cut over (1 min)

This is the switch. Everything before it was preparation.

```
npx wrangler secret put DATA_BACKEND
```

Type `supabase` and press Enter.

No deploy. It takes effect on the next request.

### Then walk the flow by hand, on your phone

1. Scan a receipt.
2. Share the code.
3. Claim an item from a second phone or a private window.
4. Mark it paid as the diner.
5. Confirm it as the host.

If any step fails:

```
npx wrangler secret put DATA_BACKEND
```

Type `base44`. You are back on the old database in under a minute, with nothing
deleted from it and nothing lost.

---

## 8 — Turn on backups (3 min)

Base44 has held the only copy of production data this whole time.

```
npx wrangler r2 bucket create billtap-backups
```

Then in `wrangler.jsonc`, uncomment the `r2_buckets` block, and:

```
npx wrangler deploy
```

The nightly cron reads whichever database is live, pages past the 200-record
cap that silently truncated the old one, and reads the object back to confirm it
landed. It throws rather than reporting success and storing nothing.

---

## 9 — Rotate the Base44 master key (2 min)

Last, and this ordering is the point: after step 7 the app no longer reads
Base44 for data, so rotating its key has no blast radius. Doing this before the
cutover would mean racing to update a Cloudflare secret before the next request.

Base44 dashboard → rotate the master key. Then:

```
npx wrangler secret put BASE44_MASTER_KEY
```

Paste the new value. Sign-in still goes through Base44 until stage 3, but that
uses the caller's own session, not this key.

---

## 10 — Make security@billtap.app deliver (5 min)

`src/pages/Security.jsx` tells people to report vulnerabilities there. Set up
forwarding before that page is linked anywhere. A published address that bounces
is worse than no address: it converts someone doing you a favour into someone
who tried and gave up.

---

## What is left after all ten

**Auth.** Restaurant operators still sign in through Base44. Deliberately last:
it is the one thing that can lock out paying customers, and nothing about it is
on fire. There are a few dozen operators, so a password reset email each is
simpler and safer than migrating hashes. Consider magic links only — no
passwords means no reset flow and no credential stuffing.

**One file upload.** `UploadFile`, to Supabase Storage or R2.

Then Base44 is gone.

---

## When to stop and ask

- The dry run reports a field you recognise as important in its dropped list.
- `has_host_key` is false on splits that should have one.
- Any step of the hand-walk in step 7 fails after the cutover — roll back first,
  then say what broke.
- The export in step 3 comes back empty **and** you know there is data there.
