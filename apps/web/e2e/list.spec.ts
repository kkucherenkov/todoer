import type { Page } from '@playwright/test';
import { expect, signIn, test } from './fixtures';

const rows = (page: Page) => page.getByTestId('task-row');
const titles = (page: Page) => page.getByTestId('task-title').allTextContents();
const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('sv'); // YYYY-MM-DD, local
};

// One test, one account (the per-IP registration budget, fixtures.ts).
test('list: quick-add, done, undo, reorder, recurring', async ({
  page,
  account,
  cli,
}) => {
  const listed = async () =>
    (
      JSON.parse(await cli(account.token, 'list', '--json')) as {
        data: { title: string; project: string | null; tags: string[] }[];
      }
    ).data;
  await page.goto('/');
  await signIn(page, account);
  const syncNow = () => page.getByTestId('sync-now').click();

  // Quick-add, with the CLI's grammar; the CLI sees the same task.
  const input = page.getByRole('textbox', { name: 'Quick add' });
  await input.fill('Buy milk #home @errand p2');
  await input.press('Enter');
  const milk = rows(page).filter({ hasText: 'Buy milk' });
  await expect(milk).toContainText('#home');
  await expect(milk).toContainText('@errand');
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
  for (
    let i = 0;
    i < 5 && !(await down.evaluate((e) => e === document.activeElement));
    i++
  ) {
    await page.keyboard.press('ArrowDown');
  }
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
});
