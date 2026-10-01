import { defineConfig } from 'vitest/config';

// Plain Node specs: data files and the db layer, which imports `vue`
// explicitly. Nuxt's own test environment is not needed.
export default defineConfig({
  test: {
    include: ['app/**/*.spec.ts', 'i18n/**/*.spec.ts'],
    environment: 'node',
  },
});
