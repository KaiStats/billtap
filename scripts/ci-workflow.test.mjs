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

test('every action is pinned to a commit, not a tag', () => {
  // A tag is a pointer its own maintainer can move, so `@v4` means "whatever
  // that repository last decided", retroactively, inside a job that holds a
  // token and runs install scripts. A sha cannot be moved.
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
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
    ['npm run build', 'the build, which catches bad imports no test imports'],
    ['scripts/check-wrangler.mjs', 'the check that staging cannot take billtap.app'],
    ['scripts/verify-dist.mjs', 'the check that every referenced image exists'],
    ['npm run test:ui', 'the browser suite — the only thing that checks what a diner sees'],
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
