import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // "Today" is the local date (ADR 0010); the fixed test clock is
    // 2026-09-26T10:00Z, which is another day in UTC+14 or UTC-11.
    env: { TZ: 'UTC' },
  },
});
