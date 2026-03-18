import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import workboxPlugin from './vite.config.augment'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    workboxPlugin(), // PWA optimization: Core-shell precaching + runtime strategies
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
    minify: 'terser',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks for better caching
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': [
            '@radix-ui/react-select',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-switch',
          ],
          'query-vendor': ['@tanstack/react-query'],
          'motion': ['framer-motion'],
        },
      },
    },
  },
})