import type { Locator, Page } from '@playwright/test';
import { arrowTo, day, expect, seedView, test } from './fixtures';

const column = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });
const card = (page: Page, name: string, title: string) =>
  column(page, name).getByTestId('card').filter({ hasText: title });
/** Drags by the card's padding (a button would not drag) into a column. */
const drag = (page: Page, from: Locator, to: string) =>
  from.dragTo(column(page, to).getByTestId('cards'), {
    sourcePosition: { x: 3, y: 3 },
  });

test('kanban: drag, Move to, done and back, recurring, columns', async ({
  page,
  account,
  cli,
}) => {
  const listed = async () =>
    (
      JSON.parse(await cli(account.token, 'list', '--json')) as {
        data: { title: string; status: string | null }[];
      }
    ).data;
  const status = async (title: string) =>
    (await listed()).find((t) => t.title === title)?.status;

  const board = await seedView(page.request, account.token, 'Board', 'a0');
  await cli(account.token, 'add', 'Card A');
  await cli(account.token, 'add', 'Card B');
  await page.goto(`/views/${board}`);

  // Columns are the seeded statuses, the completing one marked.
  await expect(page.getByTestId('column-name')).toHaveText([
    'Inbox',
    'Doing',
    'Done',
  ]);
  await expect(column(page, 'Done').getByTestId('completing')).toBeVisible();
  await expect(column(page, 'Inbox').getByTestId('card')).toHaveCount(2);

  // A drag between plain columns is a statusId; it holds after a reload.
  await drag(page, card(page, 'Inbox', 'Card A'), 'Doing');
  await expect(card(page, 'Doing', 'Card A')).toBeVisible();
  await expect.poll(() => status('Card A')).toBe('Doing');
  await page.reload();
  await expect(card(page, 'Doing', 'Card A')).toBeVisible();

  // The keyboard: a focused card opens on Enter; its menu moves it to Done.
  await card(page, 'Doing', 'Card A').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?task=[0-9a-f-]+$/);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/task=/);
  await card(page, 'Doing', 'Card A').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await arrowTo(page, page.getByRole('menuitem', { name: 'Move to' }));
  await page.keyboard.press('ArrowRight');
  await arrowTo(page, page.getByRole('menuitem', { name: 'Done' }));
  await page.keyboard.press('Enter');
  await expect(card(page, 'Done', 'Card A')).toBeVisible();
  await expect
    .poll(async () => (await listed()).map((t) => t.title))
    .toEqual(['Card B']);

  // Out of the completing column is undo, into the column it lands in.
  await drag(page, card(page, 'Done', 'Card A'), 'Doing');
  await expect(card(page, 'Doing', 'Card A')).toBeVisible();
  await expect.poll(() => status('Card A')).toBe('Doing');

  // A recurring card dropped on Done: its next occurrence, back in Inbox.
  await cli(
    account.token,
    'add',
    'Water plants',
    '--rrule',
    'FREQ=DAILY',
    '--from',
    day(),
  );
  await page.getByTestId('sync-now').click();
  const plants = card(page, 'Inbox', 'Water plants');
  await expect(plants.getByTestId('occurrence')).toHaveText(day());
  await drag(page, plants, 'Done');
  await expect(
    page.getByText(`Done for ${day()}, next ${day(1)}`, { exact: true }),
  ).toBeVisible();
  await expect(plants.getByTestId('occurrence')).toHaveText(day(1));
  await expect(card(page, 'Done', 'Water plants')).toHaveCount(0);

  // Columns: add, rename, reorder, make completing and back, delete.
  const dialog = page.getByRole('dialog');
  const open = () => page.getByRole('button', { name: 'Columns' }).click();
  const row = (name: string) =>
    dialog.getByRole('listitem', { name, exact: true });
  const names = () =>
    dialog
      .getByRole('listitem')
      .evaluateAll((items) => items.map((i) => i.getAttribute('aria-label')));
  await open();
  await dialog.getByRole('textbox', { name: 'New column' }).fill('Review');
  await dialog.getByRole('button', { name: 'Add column' }).click();
  await expect.poll(names).toEqual(['Inbox', 'Doing', 'Done', 'Review']);
  const rename = row('Review').getByRole('textbox', { name: 'Column name' });
  await rename.fill('QA');
  await rename.press('Enter');
  await expect.poll(names).toEqual(['Inbox', 'Doing', 'Done', 'QA']);
  await row('QA').getByRole('button', { name: 'Move up' }).click();
  await expect.poll(names).toEqual(['Inbox', 'Doing', 'QA', 'Done']);
  await row('QA').getByRole('button', { name: 'Make completing' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('column-name')).toHaveText([
    'Inbox',
    'Doing',
    'QA',
    'Done',
  ]);
  await expect(column(page, 'QA').getByTestId('completing')).toBeVisible();
  await expect(column(page, 'Done').getByTestId('completing')).toHaveCount(0);
  await open();
  await row('Done').getByRole('button', { name: 'Make completing' }).click();
  await page.keyboard.press('Escape');
  await expect(column(page, 'Done').getByTestId('completing')).toBeVisible();
  await expect(column(page, 'QA').getByTestId('completing')).toHaveCount(0);

  // One task on QA, by the menu; deleting QA moves it to the first column.
  await card(page, 'Inbox', 'Card B')
    .getByRole('button', { name: 'Task actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Move to' }).click();
  await page.getByRole('menuitem', { name: 'QA' }).click();
  await expect(card(page, 'QA', 'Card B')).toBeVisible();
  await expect.poll(() => status('Card B')).toBe('QA');
  await open();
  await row('QA').getByRole('button', { name: 'Delete' }).click();
  await expect(row('QA')).toContainText('1 task');
  await expect(row('QA')).toContainText('Inbox');
  await row('QA').getByRole('button', { name: 'Delete column' }).click();
  await expect.poll(names).toEqual(['Inbox', 'Doing', 'Done']);
  await page.keyboard.press('Escape');
  await expect(column(page, 'QA')).toHaveCount(0);
  await expect(card(page, 'Inbox', 'Card B')).toBeVisible();
  await expect.poll(() => status('Card B')).toBe('Inbox');
});
