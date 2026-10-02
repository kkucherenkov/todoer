import type { Page } from '@playwright/test';
import { arrowTo, day, expect, seedTask, seedView, test } from './fixtures';

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

test('calendar: moves and undo', async ({ page, account, cli }) => {
  const [mon, tue, wed, thu, fri, sat] = [0, 1, 2, 3, 4, 5].map(nextWeek) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const view = await seedView(
    page.request,
    account.token,
    'Week',
    'a0',
    'calendar',
  );
  await seedTask(page.request, account.token, {
    title: 'Report',
    scheduledOn: tue,
    dueOn: thu,
  });
  await cli(
    account.token,
    'add',
    'Water plants',
    '--rrule',
    'FREQ=DAILY',
    '--from',
    day(),
  );
  type Listed = {
    id: string;
    title: string;
    scheduledOn: string | null;
    dueOn: string | null;
    rrule: string | null;
    originOccurrence?: string | null;
  };
  const listed = async (title: string) =>
    (
      JSON.parse(await cli(account.token, 'list', '--json')) as {
        data: Listed[];
      }
    ).data.filter((t) => t.title === title);
  const drag = (from: string, title: string, to: string) =>
    chip(page, from, title).dragTo(cell(page, to), {
      sourcePosition: { x: 3, y: 3 },
    });
  const undo = () => page.getByRole('button', { name: 'Undo' }).last().click();

  await page.goto(`/views/${view}`);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(chip(page, tue, 'Report')).toBeVisible();

  // A one-off's scheduled placement sets scheduledOn; it holds after a reload.
  await drag(tue, 'Report', wed);
  await expect(chip(page, wed, 'Report')).toHaveAttribute(
    'data-kind',
    'scheduled',
  );
  await expect(chip(page, tue, 'Report')).toHaveCount(0);
  await expect
    .poll(async () => (await listed('Report'))[0]?.scheduledOn)
    .toBe(wed);
  await page.reload();
  await expect(chip(page, wed, 'Report')).toBeVisible();

  // Its due placement sets dueOn; Undo puts it back.
  await drag(thu, 'Report', fri);
  await expect(chip(page, fri, 'Report')).toHaveAttribute('data-kind', 'due');
  await expect.poll(async () => (await listed('Report'))[0]?.dueOn).toBe(fri);
  await undo();
  await expect(chip(page, thu, 'Report')).toHaveAttribute('data-kind', 'due');
  await expect.poll(async () => (await listed('Report'))[0]?.dueOn).toBe(thu);

  // An occurrence moves as a copy; the original day skips it.
  await drag(mon, 'Water plants', sat);
  await expect(chip(page, mon, 'Water plants')).toHaveCount(0);
  await expect(chip(page, sat, 'Water plants')).toHaveCount(2);
  await expect
    .poll(async () =>
      (await listed('Water plants')).map((t) => [
        t.originOccurrence ?? null,
        t.scheduledOn,
        t.rrule,
      ]),
    )
    .toContainEqual([mon, sat, null]);
  await undo();
  await expect(chip(page, mon, 'Water plants')).toHaveCount(1);
  await expect(chip(page, sat, 'Water plants')).toHaveCount(1);
  await expect.poll(async () => (await listed('Water plants')).length).toBe(1);

  // The keyboard: the chip's menu, a date, Enter.
  await chip(page, tue, 'Water plants').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await arrowTo(page, page.getByRole('menuitem', { name: 'Move to date…' }));
  await page.keyboard.press('Enter');
  await page.getByLabel('Date', { exact: true }).fill(wed);
  await page.keyboard.press('Enter');
  await expect(chip(page, tue, 'Water plants')).toHaveCount(0);
  await expect(chip(page, wed, 'Water plants')).toHaveCount(2);

  // The copy's drawer returns the occurrence to its series.
  await expect.poll(async () => (await listed('Water plants')).length).toBe(2);
  const copy = (await listed('Water plants')).find((t) => t.rrule === null)!;
  await page.locator(`[data-task-id="${copy.id}"]`).click();
  await expect(page.getByText('Moved from')).toBeVisible();
  await page.getByRole('button', { name: 'Return to series' }).click();
  await expect(page).not.toHaveURL(/task=/);
  await expect(chip(page, tue, 'Water plants')).toHaveCount(1);
  await expect(chip(page, wed, 'Water plants')).toHaveCount(1);
});
