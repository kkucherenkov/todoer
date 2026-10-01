import { afterEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AppConfig, applyTrustProxy } from './app-config.js';

const original = {
  PORT: process.env.PORT,
  TRUST_PROXY: process.env.TRUST_PROXY,
};

afterEach(() => {
  for (const [k, v] of Object.entries(original)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('AppConfig', () => {
  it('defaults the port when PORT is not set', () => {
    delete process.env.PORT;
    expect(new AppConfig().port).toBe(3000);
  });

  it('reads a port that was set', () => {
    process.env.PORT = '3010';
    expect(new AppConfig().port).toBe(3010);
  });

  // Number('abc') is NaN, and listen(NaN) binds a random free port: the
  // server comes up, reports itself healthy, and answers on a port nothing
  // else in the deployment knows about.
  it('refuses a PORT that is not a number instead of binding a random one', () => {
    process.env.PORT = 'abc';
    expect(() => new AppConfig()).toThrow(/PORT/);
  });

  it('refuses a port no socket can bind', () => {
    process.env.PORT = '70000';
    expect(() => new AppConfig()).toThrow(/PORT/);
  });

  it('refuses a port that is not whole', () => {
    process.env.PORT = '3000.5';
    expect(() => new AppConfig()).toThrow(/PORT/);
  });

  describe('TRUST_PROXY', () => {
    const read = (v?: string): number | string | undefined => {
      if (v === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = v;
      return new AppConfig().trustProxy;
    };

    it.each([undefined, ''])('is undefined when %j', (v) => {
      expect(read(v)).toBeUndefined();
    });

    it.each([
      ['1', 1],
      ['0', 0],
      ['loopback', 'loopback'],
      ['10.0.0.0/8', '10.0.0.0/8'],
      ['loopback, 172.16.0.0/12', 'loopback, 172.16.0.0/12'],
    ])('reads %j as %j', (raw, expected) => {
      expect(read(raw)).toBe(expected);
    });

    // `true` trusts every hop, so any client could forge X-Forwarded-For.
    it.each(['-1', '1.5', 'true'])('refuses %j', (raw) => {
      expect(() => read(raw)).toThrow(
        'TRUST_PROXY must be a hop count or a list of addresses/subnets',
      );
    });
  });

  describe('applyTrustProxy', () => {
    const appWith = (set: ReturnType<typeof vi.fn>) =>
      ({
        getHttpAdapter: () => ({ getInstance: () => ({ set }) }),
      }) as unknown as INestApplication;

    it('sets express "trust proxy" when configured', () => {
      const set = vi.fn();
      applyTrustProxy(appWith(set), { trustProxy: 2 });
      expect(set).toHaveBeenCalledWith('trust proxy', 2);
    });

    it('leaves express alone when unset', () => {
      const set = vi.fn();
      applyTrustProxy(appWith(set), { trustProxy: undefined });
      expect(set).not.toHaveBeenCalled();
    });
  });
});
