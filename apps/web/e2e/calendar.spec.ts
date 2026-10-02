import type { Page } from '@playwright/test';
import { day, expect, seedTask, seedView, test } from './fixtures';

const cell = (page: Page, date: string) =>
  page.locator(`[data-testid="calendar-day"][data-date="${date}"]`);
const chip = (page: Page, date: string, title: string) =>
  cell(page, date).getByTestId('placement').filter({ hasText: title });

/** The date of weekday `n` (0 = Monday) of next week, in local time. */
const nextWeek = (n: number) => day(7 - ((new Date().getDay() + 6) % 7) + n);

test('calendar: placements, navigation', async ({ page, account, cli }) => {
  const today = day();
  const tuesday = nextWeek(1);
  const thursday = nextWeek(3);
  const view = await seedView(
    page.request,
    account.token,
    'Week',
    'a0',
    'calendar',
  );
  await seedTask(page.request, account.token, {
    title: 'Report',
    scheduledOn: tuesday,
    dueOn: thursday,
  });
  await cli(
    account.token,
    'add',
    'Water plants',
    '--rrule',
    'FREQ=DAILY',
    '--from',
    today,
  );
  await page.goto(`/views/${view}`);

  // Week mode on the current week, today marked.
  await expect(page.getByRole('tab', { name: 'Week' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(cell(page, today)).toHaveAttribute('aria-current', 'date');
  await expect(chip(page, today, 'Water plants')).toBeVisible();

  // Next week: Report on its two days, the series on all seven.
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(chip(page, tuesday, 'Report')).toHaveAttribute(
    'data-kind',
    'scheduled',
  );
  await expect(chip(page, thursday, 'Report')).toHaveAttribute(
    'data-kind',
    'due',
  );
  for (let n = 0; n < 7; n++) {
    await expect(chip(page, nextWeek(n), 'Water plants')).toBeVisible();
  }
  await page.reload();
  await expect(chip(page, tuesday, 'Report')).toBeVisible();

  // Month mode keeps the day; Today returns to it.
  await page.getByRole('tab', { name: 'Month' }).click();
  await expect(chip(page, tuesday, 'Report')).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(cell(page, today)).toHaveAttribute('aria-current', 'date');
  await page.getByRole('tab', { name: 'Week' }).click();
  await expect(cell(page, today)).toHaveAttribute('aria-current', 'date');
  await expect(cell(page, tuesday)).toHaveCount(0);

  // A done occurrence stays, struck through; the next one is open.
  const id = await chip(page, today, 'Water plants').getAttribute(
    'data-task-id',
  );
  await cli(account.token, 'done', id!);
  await page.getByTestId('sync-now').click();
  const struck = chip(page, today, 'Water plants').getByTestId(
    'placement-title',
  );
  await expect(struck).toHaveClass(/line-through/);
  await expect(
    chip(page, day(1), 'Water plants').getByTestId('placement-title'),
  ).not.toHaveClass(/line-through/);
});

test('calendar: a layout switched in place does not hang the tab', async ({
  page,
  account,
  cli,
}) => {
  const view = await seedView(
    page.request,
    account.token,
    'Switch',
    'a0',
    'calendar',
  );
  await cli(account.token, 'add', 'Plain task');
  await page.goto(`/views/${view}`);
  await expect(cell(page, day())).toBeVisible();

  // Another device changes the layout while this tab watches with a span.
  await page.getByTestId('edit-view').click();
  await page.getByRole('radio', { name: 'List' }).click();
  await page.getByTestId('view-save').click();
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByTestId('calendar-day')).toHaveCount(0);

  await page.getByTestId('edit-view').click();
  await page.getByRole('radio', { name: 'Calendar' }).click();
  await page.getByTestId('view-save').click();
  await expect(cell(page, day())).toBeVisible();
});
