export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  ssr: false,
  modules: ['@nuxt/ui', '@nuxtjs/i18n'], // '@vite-pwa/nuxt' joins in Task 6
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
  vite: {
    // The worker imports client-core and sqlite-wasm: ES workers, no blob:.
    worker: { format: 'es' },
    // sqlite-wasm finds its .wasm by import.meta.url; pre-bundling breaks it.
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  },
});
