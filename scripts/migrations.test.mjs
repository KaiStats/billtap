/**
 * Every migration has to survive being pasted twice.
 *
 * ── Why this is a test and not a convention ─────────────────────────────────
 *
 * Migration 0001 explains the trap in detail and then every file after it has
 * to remember: the Supabase SQL editor runs a paste as one transaction, so a
 * single statement that raises on a second run rolls back the entire paste —
 * including any migration pasted below it. That is not a tidy failure. It is
 * how `profiles.plan_expires_at` and `guest_ratings.comment_alerted_at` end up
 * missing from a database that reports every migration as applied, under code
 * that reads them and gets a 400 back.
 *
 * The way it actually happened: 0016 opened with `create table if not exists`,
 * which announces the file as safe to re-paste, and closed with a bare
 * `create policy` — for which Postgres has no `if not exists` at all. An
 * operator bringing a partially-migrated database up to date the ordinary way,
 * 0016 through 0018 in one paste, got 42710 and lost 0017 and 0018 with it.
 *
 * A convention that four of five files followed is not a convention. This is
 * cheap, it reads the real files, and it fails on the next one that forgets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../supabase/migrations/', import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

/** Comments are prose about SQL, not SQL. Stripping them avoids false hits. */
const sqlOf = (file) =>
  readFileSync(join(DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '');

test('there are migrations to check, so a bad glob cannot pass this file', () => {
  assert.ok(files.length >= 18, `only found ${files.length} migrations`);
});

test('every create policy is preceded by a drop policy if exists', () => {
  const offenders = [];
  for (const file of files) {
    const sql = sqlOf(file);
    for (const m of sql.matchAll(/create\s+policy\s+("[^"]+"|\S+)/gi)) {
      const name = m[1];
      // The drop must name the same policy and come before the create.
      const drop = new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      const found = drop.exec(sql);
      if (!found || found.index > m.index) offenders.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [],
    'Postgres has no `if not exists` for create policy — a re-run raises 42710 and rolls back the whole paste');
});

test('every added column and created index is guarded with if not exists', () => {
  const offenders = [];
  for (const file of files) {
    const sql = sqlOf(file);
    for (const m of sql.matchAll(/add\s+column\s+(?!if\s+not\s+exists)(\S+)/gi)) {
      offenders.push(`${file}: add column ${m[1]}`);
    }
    for (const m of sql.matchAll(/create\s+(?:unique\s+)?index\s+(?!if\s+not\s+exists|concurrently)(\S+)/gi)) {
      offenders.push(`${file}: create index ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, [], 'these raise on a second run and take the rest of the paste with them');
});
