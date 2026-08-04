import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The @base44/vite-plugin was here. It injected the builder's HMR notifier,
// navigation notifier, analytics tracker and visual edit agent into every page
// this app served, and aliased @/entities and @/integrations onto the Base44
// SDK — none of which have anything left to talk to.
//
// It also quietly provided the @ → src alias that every import in this app
// uses, which is why that is written out below rather than assumed. Removing
// the plugin without it fails the build on the first import, which is the good
// version of that mistake; the bad version is a plugin nobody can remove
// because nobody remembers what else it was doing.
export default defineConfig({
  // logLevel was 'error', described as "suppress warnings, only show errors".
  //
  // What it actually suppressed was the build's only health report. Vite prints
  // the per-chunk size table and the "some chunks are larger than 500 kB"
  // warning at info level, so with this set the entry bundle grew to 507 kB
  // (167 kB gzipped) and every build since said nothing at all — output was a
  // single line about browserslist. A build that cannot tell you it got slower
  // will not tell you when it gets slower again.
  //
  // 'warn' keeps the noise floor low (no per-file "transforming..." chatter)
  // while letting the chunk-size warning through.
  logLevel: 'warn',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the vendor libraries that never change out of the entry chunk.
         *
         * Everything used to land in one 507 kB entry, which meant a one-line
         * copy edit in App.jsx invalidated React, the router, Sentry and
         * framer-motion along with it — a returning diner re-downloaded all of
         * it. These four groups are the app's stable floor; app code churns
         * weekly, they churn on `npm update`.
         *
         * Grouped rather than one-chunk-per-package on purpose. React and
         * react-dom must stay together (react-dom reaches into React's internals
         * at module-init time), and the router is only ever loaded alongside
         * them, so a finer split would only cost extra requests.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
            return 'vendor-react';
          }
          // @sentry is deliberately NOT named here.
          //
          // main.jsx goes to real trouble to load replayIntegration() from an
          // idle callback after `load`, so its ~123 kB never competes with
          // first paint, and Rollup's default chunking already honours that —
          // replay comes out as its own dynamic chunk. Naming every @sentry
          // module into one 'vendor-sentry' chunk undoes it silently: the
          // replay code gets hoisted into the eager vendor chunk, index.html
          // modulepreloads it, and src/lib/sentry-replay's chunk collapses to a
          // 0.1 kB stub. That was measured, not guessed. Leave Sentry alone.
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules/motion-dom') || id.includes('node_modules/motion-utils')) {
            return 'vendor-motion';
          }
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
        },
      },
    },
    // The default is 500 kB, which the entry chunk sits just above. Left at the
    // default deliberately: this is the number that has to keep hurting until
    // the entry comes down. Do not raise it to silence the warning.
    chunkSizeWarningLimit: 500,
  },
  plugins: [
    react(),
  ],
});
