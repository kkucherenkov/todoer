import type { Page } from '@playwright/test';
import { count, expect, seedTask, tasks, test } from './fixtures';

const rows = (page: Page) => page.getByTestId('task-row');
const row = (page: Page, title: string) =>
  rows(page).filter({
    has: page.getByTestId('task-title').filter({ hasText: title }),
  });
const dialog = (page: Page) => page.getByRole('dialog');

test('editing: delete a task and its subtasks', async ({
  page,
  account,
  cli,
}) => {
  const trip = await seedTask(page.request, account.token, { title: 'Trip' });
  for (const title of ['Passport', 'Tickets']) {
    await seedTask(page.request, account.token, { title, parentId: trip });
  }
  await seedTask(page.request, account.token, { title: 'Lone' });
  await page.goto('/');
  await expect(count(page)).toHaveText(tasks(4));

  // Cancel leaves everything in place.
  await row(page, 'Trip').getByTestId('task-title').click();
  await page.getByTestId('delete-task').click();
  await expect(dialog(page).last()).toContainText(
    'Delete “Trip” and 2 subtasks?',
  );
  await dialog(page).last().getByRole('button', { name: 'Cancel' }).click();
  await expect(row(page, 'Trip')).toBeVisible();

  // Delete, then confirm: all three go.
  await page.getByTestId('delete-task').click();
  await dialog(page).last().getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Task deleted', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/task=/);
  await expect(
    page.getByText('The task was deleted', { exact: true }),
  ).toHaveCount(0);
  const gone = async () => {
    for (const title of ['Trip', 'Passport', 'Tickets']) {
      await expect(row(page, title)).toHaveCount(0);
    }
  };
  await gone();
  await page.reload();
  await expect(count(page)).toHaveText(tasks(1));
  await gone();
  await expect
    .poll(async () =>
      (
        JSON.parse(await cli(account.token, 'list', '--json')) as {
          data: { title: string }[];
        }
      ).data.map((t) => t.title),
    )
    .toEqual(['Lone']);

  // The keyboard alone.
  await row(page, 'Lone').getByTestId('task-title').focus();
  await page.keyboard.press('Enter');
  const del = page.getByTestId('delete-task');
  await expect(del).toBeVisible();
  for (let i = 0; i < 30 && !(await del.evaluate(isActive)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(del).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog(page).last()).toContainText('Delete “Lone”?');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Lone')).toHaveCount(0);
  await expect(count(page)).toHaveText(tasks(0));
});

const isActive = (e: Element) => e === document.activeElement;

// FU4: a subtask another device adds between the subtask deletes and the
// parent delete makes the server refuse the parent; the badge shows it.
test('editing: a parent delete the server refuses shows as refused', async ({
  page,
  context,
  account,
  request,
}) => {
  const trip = await seedTask(page.request, account.token, { title: 'Trip' });
  await seedTask(page.request, account.token, {
    title: 'Passport',
    parentId: trip,
  });
  await page.goto('/');
  await expect(count(page)).toHaveText(tasks(2));

  await context.setOffline(true);
  await row(page, 'Trip').getByTestId('task-title').click();
  await page.getByTestId('delete-task').click();
  await dialog(page).last().getByRole('button', { name: 'Delete' }).click();
  await expect(row(page, 'Trip')).toHaveCount(0);
  await expect(page.getByTestId('pending')).toBeVisible();

  // Another device adds a subtask the tab has not pulled.
  await seedTask(request, account.token, { title: 'Visa', parentId: trip });

  await context.setOffline(false);
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('failed')).toHaveText('1 refused', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('pending')).toHaveCount(0);
  // Nothing hides what the server kept.
  await expect(row(page, 'Trip')).toBeVisible();
  await expect(row(page, 'Visa')).toBeVisible();
});
