import type { Page } from '@playwright/test';
import { arrowTo, count, day, expect, test } from './fixtures';

/** Opens a task by URL without a reload: the router follows a popstate. */
const visit = (page: Page, task: string) =>
  page.evaluate((id) => {
    history.pushState(history.state, '', `/?task=${id}`);
    dispatchEvent(
      new PopStateEvent('popstate', { state: history.state as unknown }),
    );
  }, task);

const rows = (page: Page) => page.getByTestId('task-row');
const titles = (page: Page) => page.getByTestId('task-title').allTextContents();

type Listed = {
  id: string;
  title: string;
  notes: string | null;
  priority: number;
  dueOn: string | null;
  project: string | null;
  tags: string[];
};

test('list: quick-add, done, undo, reorder, recurring', async ({
  page,
  account,
  cli,
  request,
}) => {
  const listed = async () =>
    (
      JSON.parse(await cli(account.token, 'list', '--json')) as {
        data: Listed[];
      }
    ).data;
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  const syncNow = () => page.getByTestId('sync-now').click();

  // Quick-add, with the CLI's grammar; the CLI sees the same task.
  const input = page.getByRole('textbox', { name: 'Quick add' });
  await input.fill('Buy milk #home @errand p2');
  await input.press('Enter');
  const milk = rows(page).filter({ hasText: 'Buy milk' });
  await expect(milk).toContainText('#home');
  await expect(milk).toContainText('@errand');
  await expect(milk, 'the stored tag, as is (F8)').not.toContainText('@@');
  await expect(milk).toContainText('p2');
  await expect(input).toHaveValue('');
  await expect
    .poll(async () => (await listed()).map((t) => [t.title, t.project, t.tags]))
    .toEqual([['Buy milk', 'home', ['@errand']]]);

  // Markers only: refused, the text stays.
  await input.fill('#home');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('That cannot be done.');
  await expect(input).toHaveValue('#home');
  await input.fill('');

  // Done leaves the list; the toast's Undo brings it back.
  await milk.getByRole('button', { name: 'Mark done' }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect.poll(listed).toEqual([]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(milk).toHaveCount(1);
  await expect.poll(async () => (await listed()).length).toBe(1);

  // Three more from the CLI, all rank a0: a drop on a tie is exact.
  for (const t of ['Two', 'Three', 'Four']) await cli(account.token, 'add', t);
  await syncNow();
  await expect(rows(page)).toHaveCount(4);
  const before = await titles(page);
  const grip = { x: 3, y: 3 }; // the row's padding: a button would not drag
  await rows(page)
    .nth(3)
    .dragTo(rows(page).nth(0), {
      sourcePosition: grip,
      targetPosition: { x: 20, y: 2 },
    });
  const dropped = [before[3]!, before[0]!, before[1]!, before[2]!];
  await expect.poll(() => titles(page)).toEqual(dropped);
  await page.reload();
  await expect.poll(() => titles(page)).toEqual(dropped);

  // The keyboard: focus the menu, Enter, arrows to "Move down", Enter.
  await rows(page).nth(0).getByRole('button', { name: 'Task actions' }).focus();
  await page.keyboard.press('Enter');
  const down = page.getByRole('menuitem', { name: 'Move down' });
  await arrowTo(page, down);
  await page.keyboard.press('Enter');
  const moved = [dropped[1]!, dropped[0]!, dropped[2]!, dropped[3]!];
  await expect.poll(() => titles(page)).toEqual(moved);
  await page.reload();
  await expect.poll(() => titles(page)).toEqual(moved);

  // A recurring task shows its current occurrence; done moves it on.
  await cli(
    account.token,
    'add',
    'Water plants',
    '--rrule',
    'FREQ=DAILY',
    '--from',
    day(),
  );
  await syncNow();
  const plants = rows(page).filter({ hasText: 'Water plants' });
  await expect(plants.getByTestId('occurrence')).toHaveText(day());
  await plants.getByRole('button', { name: 'Mark done' }).click();
  await expect(
    page.getByText(`Done for ${day()}, next ${day(1)}`, { exact: true }),
  ).toBeVisible();
  await expect(plants.getByTestId('occurrence')).toHaveText(day(1));

  // The drawer edits every field, each saving on blur or change.
  await milk.getByTestId('task-title').click();
  const drawer = page.getByRole('dialog');
  await expect(page).toHaveURL(/\?task=[0-9a-f-]+$/);
  await drawer.getByLabel('Title').fill('Buy oat milk');
  await drawer.getByLabel('Notes').fill('Two cartons');
  await drawer.getByLabel('Notes').blur();
  await drawer.getByRole('button', { name: 'Project' }).click();
  await page.keyboard.type('work');
  await page.getByRole('option', { name: /^Create .work.$/ }).click();
  await drawer.getByRole('button', { name: 'Tags' }).click();
  await page.keyboard.type('@calls');
  await page.getByRole('option', { name: /^Create .@calls.$/ }).click();
  await page.keyboard.press('Escape');
  await drawer.getByRole('radio', { name: 'p3' }).click();
  await drawer.getByRole('textbox', { name: 'Due' }).fill(day(1));

  // The list shows it at once; Esc closes the drawer.
  const oat = rows(page).filter({ hasText: 'Buy oat milk' });
  await expect(oat).toContainText('#work');
  await expect(oat).toContainText('@calls');
  await expect(oat).toContainText('p3');
  await expect(oat).toContainText(day(1));
  await drawer.getByRole('heading', { name: 'Task', exact: true }).click(); // out of the date field
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);

  // The CLI sees each field, and the project exists once.
  await expect
    .poll(async () => (await listed()).find((t) => t.title === 'Buy oat milk'))
    .toMatchObject({
      notes: 'Two cartons',
      priority: 3,
      dueOn: day(1),
      project: 'work',
      tags: ['@calls', '@errand'],
    });
  const pulled = await request.post('/api/v1/sync', {
    headers: { authorization: `Bearer ${account.token}` },
    data: { since: 0, ops: [] },
  });
  const changes = (
    (await pulled.json()) as {
      changes: { table: string; row: { name?: string } }[];
    }
  ).changes;
  expect(
    changes.filter((c) => c.table === 'project' && c.row.name === 'work'),
  ).toHaveLength(1);

  // Reopen after a reload: the values are there.
  const { id } = (await listed()).find((t) => t.title === 'Buy oat milk')!;
  await page.goto(`/?task=${id}`);
  await expect(drawer.getByLabel('Title')).toHaveValue('Buy oat milk');
  await expect(drawer.getByLabel('Notes')).toHaveValue('Two cartons');
  await expect(drawer.getByRole('textbox', { name: 'Due' })).toHaveValue(
    day(1),
  );
  await expect(drawer.getByRole('radio', { name: 'p3' })).toBeChecked();
  await expect(drawer.getByRole('button', { name: 'Project' })).toContainText(
    'work',
  );
  await expect(drawer.getByRole('button', { name: 'Tags' })).toContainText(
    '@calls',
  );

  // Clearing a date sends null.
  await drawer.getByRole('button', { name: 'Clear Due' }).click();
  await expect
    .poll(async () => (await listed()).find((t) => t.id === id)?.dueOn)
    .toBeNull();

  // The completing status is `done`: the task leaves the list.
  await drawer.getByRole('button', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await expect(oat).toHaveCount(0);
  await expect
    .poll(async () => (await listed()).map((t) => t.title))
    .not.toContain('Buy oat milk');

  // An unknown id is said so, not left blank.
  await visit(page, '00000000-0000-4000-8000-000000000000');
  await expect(drawer).toContainText('no longer exists');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // A recurring task's schedule is the rule's: shown, not editable.
  await plants.getByTestId('task-title').click();
  await expect(page.getByTestId('rule')).toContainText(day(1));
  await expect(page.getByTestId('rule')).toContainText('FREQ=DAILY');
  await expect(drawer.getByRole('textbox', { name: 'Scheduled' })).toHaveCount(
    0,
  );
  await expect(drawer.getByRole('textbox', { name: 'Due' })).toBeEditable();

  // A series that has ended still opens, read-only (not "no longer exists").
  const ended = (
    JSON.parse(
      await cli(
        account.token,
        'add',
        'Once more',
        '--rrule',
        'FREQ=DAILY;COUNT=1',
        '--from',
        day(-1),
        '--json',
      ),
    ) as { data: { id: string } }
  ).data.id;
  await cli(account.token, 'done', ended);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await syncNow();
  await visit(page, ended);
  await expect(drawer).toContainText('This series has ended');
  await expect(drawer.getByLabel('Title')).toBeDisabled();
});
