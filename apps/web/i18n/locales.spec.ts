import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FAILURE_KINDS } from '@todoer/client-core';
import { pluralForm } from '../app/utils/plural';

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

  it.each([
    [
      'en',
      en,
      ['0 tasks', '1 task', '2 tasks', '5 tasks', '11 tasks', '21 tasks'],
    ],
    [
      'ru',
      ru,
      ['0 задач', '1 задача', '2 задачи', '5 задач', '11 задач', '21 задача'],
    ],
  ])('%s words the task count', (locale, flat, words) => {
    const render = (n: number) =>
      flat[`summary.tasks.${pluralForm(locale, n)}`]!.replace('{n}', `${n}`);
    expect([0, 1, 2, 5, 11, 21].map(render)).toEqual(words);
    expect(render(22)).toBe(locale === 'ru' ? '22 задачи' : '22 tasks');
    expect(render(25)).toBe(locale === 'ru' ? '25 задач' : '25 tasks');
  });
});
