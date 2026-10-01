import { defineConfig } from 'vitest/config';

// Plain Node specs over data files; Nuxt's own test environment is not needed.
export default defineConfig({ test: { include: ['i18n/**/*.spec.ts'] } });
