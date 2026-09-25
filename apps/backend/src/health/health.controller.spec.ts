import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';
import { AppConfig } from '../config/app-config.js';

describe('HealthController', () => {
  it('reports the version from configuration, not from package.json', () => {
    const config = { version: '9.9.9' } as AppConfig;
    const controller = new HealthController(config);

    expect(controller.get()).toEqual({ status: 'ok', version: '9.9.9' });
  });
});
