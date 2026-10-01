export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  modules: ['@nuxt/ui', '@nuxtjs/i18n', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  // The backend caches /_nuxt/ as immutable and everything else as no-cache
  // (W1 notes): stated, not defaulted, so a change here is a visible one.
  app: { buildAssetsDir: '/_nuxt/' },
  // 3000 is the backend's default.
  devServer: { port: 3001 },
  // One origin in development too (Q9): the cookie's Path is /api/v1/auth.
  nitro: {
    devProxy: {
      '/api': { target: 'http://localhost:3000/api', changeOrigin: true },
    },
  },
  // Departure 5: no build-time font download, nothing served from /_fonts/.
  ui: { fonts: false },
  // connect-src is 'self': the Iconify API is unreachable. Icons ship in
  // the client bundle.
  icon: { provider: 'none', clientBundle: { scan: true } },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'ru', name: 'Русский', file: 'ru.json' },
    ],
    detectBrowserLanguage: { useCookie: true, cookieKey: 'todoer_locale' },
  },
  pwa: {
    registerType: 'prompt', // never reload under the user (Review Focus 5)
    strategies: 'generateSW',
    manifest: {
      name: 'todoer',
      short_name: 'todoer',
      start_url: '/',
      display: 'standalone',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,wasm,svg,json,webmanifest}'],
      // Nuxt's generate leaves 200.html and 404.html: the server has no
      // such URL, and one failed precache fetch fails the install.
      globIgnores: ['200.html', '404.html', '_nuxt/builds/**'],
      // The module renames index.html to "/", and the backend answers "/"
      // only to Accept: text/html, which a precache fetch does not send: the
      // 404 fails the install. Keep the entry as /index.html (served for any
      // Accept) so it matches navigateFallback.
      manifestTransforms: [async (manifest) => ({ manifest, warnings: [] })],
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // sqlite3.wasm is ~0.9 MB
      cleanupOutdatedCaches: true,
      navigateFallback: '/index.html',
      // The API and health are never answered from the cache (Q9 "Cost").
      navigateFallbackDenylist: [/^\/api(\/|$)/i, /^\/health(\/|$)/i],
    },
    client: { installPrompt: false, periodicSyncForUpdates: 3600 },
  },
  vite: {
    // The worker imports client-core and sqlite-wasm: ES workers, no blob:.
    worker: { format: 'es' },
    // sqlite-wasm finds its .wasm by import.meta.url; pre-bundling breaks it.
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  },
});
