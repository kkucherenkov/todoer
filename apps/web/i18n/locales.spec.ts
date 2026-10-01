import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAILURE_KINDS } from '../app/db/protocol';

type Tree = { [key: string]: string | Tree };

const load = (name: string): Tree =>
  JSON.parse(
    readFileSync(new URL(`./locales/${name}.json`, import.meta.url), 'utf8'),
  ) as Tree;

const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((out, [k, v]) => {
    const key = prefix + k;
    return typeof v === 'string'
      ? { ...out, [key]: v }
      : { ...out, ...flatten(v, `${key}.`) };
  }, {});

describe('locales', () => {
  const en = flatten(load('en'));
  const ru = flatten(load('ru'));

  it('en and ru define the same keys', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it.each([
    ['en', en],
    ['ru', ru],
  ])('%s has no empty value', (_, flat) => {
    expect(Object.entries(flat).filter(([, v]) => v.trim() === '')).toEqual([]);
  });

  it.each([
    ['en', en],
    ['ru', ru],
  ])('%s words every failure kind', (_, flat) => {
    expect(FAILURE_KINDS.filter((k) => !(`errors.${k}` in flat))).toEqual([]);
  });
});
