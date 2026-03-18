/**
 * Vite Plugin: Optimized PWA Precaching with Core Shell Model
 * 
 * Precaches only core app shell (html, js, css, fonts)
 * Images and non-critical assets are lazy-loaded with runtime caching
 * 
 * Memory footprint: ~1MB precache + dynamic caches (images: ~30MB max)
 * Initial memory: <20MB (core shell only)
 */

import { injectManifest } from 'workbox-build';
import path from 'path';

export default function workboxPlugin() {
  return {
    name: 'workbox-build',
    apply: 'build',
    async closeBundle() {
      try {
        const manifest = await injectManifest({
          // Directory where production build files are located
          globDirectory: 'dist',

          // CORE APP SHELL ONLY - These files are precached
          globPatterns: [
            'index.html',                    // Entry point
            'manifest.json',                 // PWA manifest
            '*.{js,css}',                    // Main bundles & chunks (versioned)
            'fonts/**/*.{woff,woff2,ttf}',   // Web fonts (critical for rendering)
            'favicon.svg',                   // Small icon
          ],

          // EXCLUDE images and non-critical assets
          globIgnores: [
            '**/node_modules/**/*',
            '**/*.{png,jpg,jpeg,gif,webp}', // All images - lazy load instead
            'assets/**/*.svg',               // Exclude from assets (except favicon above)
            '**/*.map',                      // Source maps (debug only)
            '**/service-worker.js',          // Don't cache the SW itself
          ],

          // Strict size limit for precached files (1MB max per file)
          maximumFileSizeToCacheInBytes: 1 * 1024 * 1024,

          // Cache busting for versioned files (e.g., app.abc12345.js)
          dontCacheBustURLsMatching: /\.[0-9a-f]{8}\./,

          // Source and destination for service worker
          swSrc: 'public/service-worker.js',
          swDest: 'dist/service-worker.js',

          // Clean up old caches automatically
          cleanupOutdatedCaches: true,

          // Verbose logging
          verbose: true,
        });

        // Log results
        console.log(`\n[workbox] ✅ PWA Optimization Summary:`);
        console.log(`  📦 Precached files: ${manifest.count}`);
        console.log(`  💾 Precache size: ${(manifest.size / 1024).toFixed(2)}KB`);
        console.log(`  🖼️  Images: Lazy-loaded (StaleWhileRevalidate)`);
        console.log(`  🌐 APIs: NetworkFirst with 5s timeout`);
        console.log(`  📝 Fonts: CacheFirst (1 year)`);
        console.log(`  🎯 Target memory: <20MB initial\n`);
      } catch (error) {
        console.error('[workbox] Build failed:', error);
        throw error;
      }
    },
  };
}