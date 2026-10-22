import { visibleWidth } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWrite } from './write.js';
import { KEY, renderApp } from './pi/test-kit.js';
import { Sidebar } from './sidebar.js';

let cleanup = () => {};
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const ESC = '\u001b';
const plain = (s: string) =>
  s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');

async function seeded(onPick: (key: string) => void = () => undefined) {
  let sidebar!: Sidebar;
  const t = await renderApp({
    width: 30,
    app: ({ topics }) => (sidebar = new Sidebar({ topics, onPick })),
  });
  cleanup = t.cleanup;
  const write = createWrite(t);
  await write((newId) => ({
    kind: 'add',
    opId: newId(),
    id: newId(),
    text: 'milk #home @shop',
  }));
  await write((newId) => ({
    kind: 'saveView',
    opId: newId(),
    id: newId(),
    fields: {
      name: 'Mine',
      layout: 'list',
      sort: 'manual',
      filter: { and: [] },
    },
  }));
  await t.settle();
  return { t, sidebar };
}

describe('Sidebar', () => {
  it('lists built-ins, projects, tags and saved views with core counts', async () => {
    const { t } = await seeded();
    const lines = t.lines().map(plain);
    const at = (s: string) => lines.findIndex((l) => l.includes(s));
    const headers = ['VIEWS', 'PROJECTS', 'TAGS', 'SAVED'].map(at);
    expect(headers.every((i) => i >= 0)).toBe(true);
    expect([...headers].sort((a, b) => a - b)).toEqual(headers);
    const nav = t.topics.get('catalog')?.nav ?? [];
    expect(nav.find((n) => n.key === 'all')?.count).toBe(1);
    const row = (name: string) => lines[at(name)] ?? '';
    for (const [name, key] of [
      ['All open', 'all'],
      ['Today', 'today'],
      ['home', `project:${t.topics.get('catalog')?.projects[0]?.id}`],
      ['@shop', `tag:${t.topics.get('catalog')?.tags[0]?.id}`],
    ] as const) {
      const count = nav.find((n) => n.key === key)?.count;
      expect(row(name)).toMatch(new RegExp(`${name}\\s+${count}$`));
    }
    expect(row('Mine')).toMatch(/Mine\s*$/);
    expect(lines.every((l) => visibleWidth(l) <= 30)).toBe(true);
  });

  it('Enter on a tag row watches tag:<id>', async () => {
    const picked: string[] = [];
    const { t } = await seeded((key) => picked.push(key));
    await t.press('j', 'j', 'j', 'j', KEY.enter);
    const tag = t.topics.get('catalog')?.tags[0]?.id;
    expect(picked).toEqual([`tag:${tag}`]);
  });

  it('marks the current key and moves with j, k and the arrows', async () => {
    const { t, sidebar } = await seeded();
    sidebar.current = 'today';
    const marked = () =>
      t
        .lines()
        .map(plain)
        .filter((l) => l.startsWith('▸'));
    expect(marked()).toEqual([expect.stringContaining('All open')]);
    await t.press(KEY.down, 'j', 'k', KEY.up, KEY.up);
    expect(marked()).toEqual([expect.stringContaining('All open')]);
    expect(t.frame()).toMatch(new RegExp(`${ESC}\\[1m[^\\n]*Today`));
  });

  it('draws no colour under NO_COLOR', async () => {
    vi.stubEnv('NO_COLOR', '1');
    const { t, sidebar } = await seeded();
    sidebar.current = 'today';
    expect(t.frame()).not.toMatch(new RegExp(`${ESC}\\[3\\dm`));
    expect(t.frame()).toContain('Today');
  });
});
