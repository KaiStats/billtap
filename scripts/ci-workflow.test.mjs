/**
 * The pipeline's own configuration, checked by the pipeline.
 *
 * Everything CI enforces about this codebase was, until now, enforced by a file
 * nothing enforced anything about. A deleted step, an unpinned action or a
 * write-scoped token would all have gone in as a green build.
 *
 * Read as text rather than parsed as YAML on purpose: the only YAML parser in
 * the tree arrives transitively through eslint, and a test that breaks when a
 * linter reorganises its dependencies is a test people learn to ignore. The
 * assertions below are about lines, and lines are what this reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

/**
 * The workflow with its comments removed.
 *
 * This file explains at length what each step is for and what went wrong
 * before it existed — including quoting `timeout-minutes: 10`, the value that
 * caused the run that prompted the split. Matching against the raw text makes
 * documenting a hazard a way to trip the test that guards it, which has now
 * happened three times in this repo: the sign-out keys, the CSP handler, and
 * this. Structure is what the assertions are about, so structure is what they
 * read; the prose assertions below deliberately keep using the raw text.
 */
const directives = workflow.replace(/(^|\s)#.*$/gm, '$1');

test('every action is pinned to a commit, not a tag', () => {
  // A tag is a pointer its own maintainer can move, so `@v4` means "whatever
  // that repository last decided", retroactively, inside a job that holds a
  // token and runs install scripts. A sha cannot be moved.
  const uses = [...directives.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 2, 'expected the checkout and setup-node actions');

  for (const ref of uses) {
    assert.match(
      ref,
      /@[0-9a-f]{40}$/,
      `${ref} is pinned to a tag — pin the commit sha and put the version in a comment`,
    );
  }
});

test('a pinned action still says which version it is', () => {
  // A bare sha is unreadable and un-updatable by hand. The trailing comment is
  // what makes the pin maintainable rather than merely frozen, and it is what
  // Dependabot keeps in step — see .github/dependabot.yml.
  const lines = workflow.split('\n').filter((l) => /uses:\s*\S+@[0-9a-f]{40}/.test(l));
  for (const line of lines) {
    assert.match(
      line,
      /#\s*v?\d+\.\d+/,
      `pinned action has no version comment: ${line.trim()}`,
    );
  }
});

test('the workflow token is read-only', () => {
  // With no permissions block the token inherits the repository default, which
  // on older repositories is write on everything. This job runs `npm ci`, which
  // executes install scripts from the whole tree, so a supply-chain compromise
  // gets a shell here — and should not also get a token that can push to main
  // and rewrite this file.
  assert.match(workflow, /^permissions:/m, 'no permissions block — the token defaults to the repo setting');

  const block = workflow.slice(workflow.indexOf('\npermissions:'));
  const body = block.slice(0, block.indexOf('\n\n'));
  assert.doesNotMatch(body, /:\s*write/, `workflow-level permissions grant write: ${body.trim()}`);
  assert.match(body, /contents:\s*read/, 'the job needs to read the code and nothing else');
});

test('runs are deduplicated rather than stacked', () => {
  // The suite installs Chromium and drives a browser. Without a concurrency
  // group, a branch with a PR open runs the whole thing twice per commit —
  // once for `push`, once for `pull_request` — plus once more for every push
  // that lands while the last one is still going.
  assert.match(workflow, /^concurrency:/m, 'no concurrency group');
  assert.match(
    workflow,
    /group:\s*ci-\$\{\{\s*github\.event\.pull_request\.head\.ref\s*\|\|\s*github\.ref/,
    'the group must key on the head branch, or the push and pull_request runs do not collapse',
  );
});

test('no gate has quietly gone missing', () => {
  // Each of these caught something real, and each is one deleted line from not
  // running. Named here so removing one is a decision somebody has to argue
  // with rather than a diff nobody notices.
  const required = [
    ['npm run lint', 'the lint gate — it was checking almost nothing until the flat config was repaired'],
    ['npm run test:unit', 'the money-path suite, including the concurrent-claim and participant-key tests'],
    ['npm run typecheck', 'the type gate — it sat at 153 errors and outside CI until it was driven to zero'],
    ['npm run build', 'the build, which catches bad imports no test imports'],
    ['scripts/check-wrangler.mjs', 'the check that staging cannot take billtap.app'],
    ['scripts/verify-dist.mjs', 'the check that every referenced image exists'],
    ['npm run test:ui', 'the browser suite — the only thing that checks what a diner sees'],
    ['npm run test:boundaries', 'the Vitest boundary suite — every error boundary, made to fail'],
    ['npm run test:e2e', 'the boundary suite in a browser, which is where the console leak was found'],
  ];

  for (const [command, why] of required) {
    assert.ok(
      workflow.includes(command),
      `CI no longer runs "${command}" — ${why}`,
    );
  }
});

test('the browser suite still runs after Chromium is installed', () => {
  // It was moved once already for this reason. Ordering is the whole
  // correctness of these two steps.
  assert.ok(
    workflow.indexOf('playwright install') < workflow.indexOf('npm run test:ui'),
    'test:ui runs before Chromium is installed, so it would fail for the wrong reason',
  );
});

test('the workflow says what it cannot do', () => {
  // main is unprotected, so every check here is advisory. That is a repository
  // setting rather than a file, which makes it exactly the kind of thing that
  // goes unrecorded — and a green tick that nobody is required to wait for is
  // worth knowing about.
  assert.match(
    workflow,
    /unprotected/,
    'the workflow must state that main is unprotected until it is not',
  );
});

// ── The two things that actually went red ───────────────────────────────────
//
// "The job has exceeded the maximum execution time of 10m0s" and "Node.js 20 is
// deprecated. The following actions target Node.js 20 but are being forced to
// run on Node.js 24." Neither was a code failure; both were this file.

test('the slow work and the fast work are separate jobs', () => {
  // They were one job with a ten-minute limit. Measured locally the static
  // checks are ~50s together and the browser suite alone is ~270s, and a hosted
  // runner is slower — plus npm ci and a Chromium download. Sequentially that
  // does not fit, and it did not.
  const jobs = [...directives.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1]);
  assert.ok(jobs.includes('checks'), 'expected a "checks" job');
  assert.ok(jobs.includes('browser'), 'expected a separate "browser" job');
  assert.ok(
    workflow.indexOf('npm run test:ui') > workflow.indexOf('  browser:'),
    'the browser suite must live in the browser job, not back in checks',
  );
});

test('every job declares a timeout, and the slow one gets more than the fast one', () => {
  const timeouts = [...directives.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(timeouts.length, 2, 'every job needs its own timeout — a hang should still be killed');
  assert.ok(
    Math.max(...timeouts) >= 15,
    'the browser job needs room for a ~270s suite plus install on a slower runner',
  );
});

test('no action is left on a runtime GitHub has deprecated', () => {
  // The version comment is the only thing in the file that says which release a
  // sha is. checkout and setup-node moved to Node 24 at v5; anything below that
  // is what produced the deprecation warning.
  const pins = [...workflow.matchAll(/uses:\s*actions\/([\w-]+)@[0-9a-f]{40}\s*#\s*v(\d+)/g)];
  assert.ok(pins.length >= 2, 'expected the checkout and setup-node pins');

  const MINIMUM = { checkout: 5, 'setup-node': 5, cache: 4 };
  for (const [, name, major] of pins) {
    const floor = MINIMUM[name];
    if (!floor) continue;
    assert.ok(
      Number(major) >= floor,
      `actions/${name} is pinned to v${major}; v${floor}+ is the first that targets Node 24, ` +
      'and GitHub now forces older ones onto a runtime they were not built for',
    );
  }
});

test('the Chromium download is cached', () => {
  // One to two minutes of every browser run, and it only changes when the
  // playwright version does — which is in the lockfile, so that is the key.
  assert.match(workflow, /actions\/cache@[0-9a-f]{40}/, 'no cache step for the browser download');
  assert.match(workflow, /~\/\.cache\/ms-playwright/, 'the cache must point at the playwright browser path');
  assert.match(
    workflow,
    /key:\s*playwright-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/,
    'key the cache on the lockfile, which is what pins the playwright version',
  );
  // --with-deps stays: the apt packages are outside the cached path.
  assert.match(workflow, /playwright install --with-deps chromium/);
});
