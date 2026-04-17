import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Mygration — Vite config
// - Proxies /api to the local Flask backend in dev
// - PWA plugin: precaches the app shell + runtime-caches API responses so the
//   dashboard survives being offline (or the backend being down) without
//   losing the last-known weather view.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        // If we're offline and user navigates, serve index.html from precache
        // (SPA fallback). Keeps the app shell reachable.
        navigateFallback: '/index.html',
        // New SW takes over immediately so a bad version doesn't linger.
        clientsClaim: true,
        skipWaiting: true,
        // Include the static shell + manifest/icons in precache.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],

        runtimeCaching: [
          // Locations list (and related GETs): NetworkFirst, 5-minute cache.
          // Fresh when online, last-known when offline.
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/locations'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mygration-locations',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Weather summary + detail: NetworkFirst, 15-minute cache — matches
          // the backend cache TTL so offline users see what they last saw.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/children/') &&
              (url.pathname.endsWith('/weather') ||
                url.pathname.endsWith('/weather/detail')),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mygration-weather',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 15 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Historical digests: effectively immutable — cache aggressively.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/children/') &&
              url.pathname.endsWith('/weather/historical'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'mygration-historical',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Geocode search — always need fresh suggestions, don't cache.
          {
            urlPattern: ({ url }) => url.pathname === '/api/geocode/search',
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Mygration',
        short_name: 'Mygration',
        description: 'Weather planning for van life',
        // Match the dark dashboard palette so splash + status bar feel
        // continuous with the app.
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          // Custom bird-silhouette PNGs haven't been drawn yet (backlog item).
          // The SVG favicon is scalable — works at any size as a stopgap.
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
