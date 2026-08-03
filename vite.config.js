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
  logLevel: 'error', // Suppress warnings, only show errors
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  plugins: [
    react(),
  ],
});
