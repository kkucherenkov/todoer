import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.{ts,tsx}'],
    // "Today" is the local date (ADR 0010); tests fix the clock in UTC.
    env: { TZ: 'UTC' },
  },
});
