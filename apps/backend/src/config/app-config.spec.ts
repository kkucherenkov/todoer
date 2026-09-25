import { afterEach, describe, expect, it } from 'vitest';
import { AppConfig } from './app-config.js';

const original = process.env.PORT;

afterEach(() => {
  if (original === undefined) delete process.env.PORT;
  else process.env.PORT = original;
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
});
