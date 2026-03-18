/**
 * Vite plugin configuration for workbox PWA build integration
 * This augments the existing vite.config.js with PWA capabilities
 * 
 * To use:
 * 1. Import this in vite.config.js: import workboxPlugin from './vite.config.augment'
 * 2. Add to plugins: workboxPlugin()
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
          globDirectory: 'dist',
          globPatterns: [
            '**/*.{html,js,css,png,jpg,jpeg,svg,gif,webp,woff,woff2}',
          ],
          globIgnores: [
            '**/node_modules/**/*',
            'service-worker.js',
            'manifest.json',
          ],
          swSrc: 'public/service-worker.js',
          swDest: 'dist/service-worker.js',
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
          dontCacheBustURLsMatching: /\.[0-9a-f]{8}\./,
        });

        console.log(`[workbox] Precached ${manifest.count} files.`);
        console.log(`[workbox] Service worker generated: ${manifest.count} files, ` +
          `${(manifest.size / 1024).toFixed(2)}KB total.`);
      } catch (error) {
        console.error('[workbox] Build failed:', error);
        throw error;
      }
    },
  };
}