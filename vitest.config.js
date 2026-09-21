import { defineConfig, configDefaults } from 'vitest/config'

/**
 * Vitest, scoped to the error-handling boundary suites.
 *
 * ── Why this does not swallow the other 644 tests ───────────────────────────
 *
 * The rest of this repo runs on node:test, and it is not a placeholder: those
 * suites cover the concurrent-claim race, the participant-key authorisation and
 * the money maths, and they are the gate on every push. Rewriting 644 passing
 * assertions to change which runner prints the dots is a large, risky diff that
 * buys nothing a reviewer can see.
 *
 * So the two coexist, on purpose and with a boundary between them: `include`
 * below matches only `*.boundary.test.js`, and `npm run test:unit` still runs
 * node:test over everything else. `npm test` runs both, and CI runs `npm test`,
 * so neither can rot unnoticed.
 *
 * If the whole suite is ever moved onto Vitest, this file is where that starts
 * — widen `include` and delete the node:test invocation together, in one commit
 * that changes no assertions.
 */
export default defineConfig({
  test: {
    include: ['**/*.boundary.test.js'],
    // `include` is deliberately unanchored so a suite can live beside the code
    // it guards. That also matches git worktrees under .claude/, which are
    // checkouts of this same repo: without this the boundary suite ran three
    // times — once here and once per worktree — and a stale copy could fail a
    // run that has nothing to do with the working tree.
    exclude: [...configDefaults.exclude, '.claude/**'],
    // Workers code, not a browser. Nothing here touches the DOM, and a jsdom
    // environment would quietly provide globals the runtime does not have.
    environment: 'node',
    // These suites stub globalThis.fetch. Sharing one global between files
    // running in parallel is how a stub leaks into a neighbouring test and
    // produces a failure that cannot be reproduced alone.
    fileParallelism: false,
    reporters: ['default'],
  },
})
