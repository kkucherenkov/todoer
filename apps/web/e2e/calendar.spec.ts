import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  arrowTo,
  count,
  day,
  expect,
  seedTask,
  seedView,
  tasks,
  test,
} from './fixtures';

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
  // A copy is a one-off: it cannot become a series of its own.
  await page.getByText('More details').click();
  await expect(page.getByRole('button', { name: 'Status' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Repeat…' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to series' }).click();
  await expect(page).not.toHaveURL(/task=/);
  await expect(chip(page, tue, 'Water plants')).toHaveCount(1);
  await expect(chip(page, wed, 'Water plants')).toHaveCount(1);
});

test('calendar: P0 chip shows p0, P4 chip shows none', async ({
  page,
  account,
}) => {
  const today = day();
  const view = await seedView(
    page.request,
    account.token,
    'Week',
    'a0',
    'calendar',
  );
  await seedTask(page.request, account.token, {
    title: 'Urgent',
    priority: 0,
    scheduledOn: today,
  });
  await seedTask(page.request, account.token, {
    title: 'Plain',
    priority: 4,
    scheduledOn: today,
  });
  await page.goto(`/views/${view}`);
  await expect(chip(page, today, 'Urgent')).toContainText('p0');
  await expect(chip(page, today, 'Plain')).toBeVisible();
  await expect(chip(page, today, 'Plain')).not.toContainText(/\bp\d\b/);
});

/** The days' top-left corners, in order, rounded to whole pixels. */
const corners = (page: Page) =>
  page.getByTestId('calendar-day').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y)] as const;
    }),
  );
const columns = async (page: Page) =>
  new Set((await corners(page)).map(([x]) => x)).size;

test('calendar: a grid on a desktop, a list of dated days on a phone', async ({
  page,
  account,
}) => {
  const today = day();
  const long =
    'Prepare the quarterly report for the board, with every appendix and the reviewed budget';
  const view = await seedView(
    page.request,
    account.token,
    'Week',
    'a0',
    'calendar',
  );
  await seedTask(page.request, account.token, {
    title: long,
    scheduledOn: today,
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/views/${view}`);

  // Every day shows its full date as text, the name of its region.
  const label = await cell(page, today).getAttribute('aria-label');
  expect(label).toMatch(/\d{4}/);
  await expect(cell(page, today)).toContainText(label!);
  // A long title wraps rather than being cut off.
  const title = chip(page, today, 'quarterly report').getByTestId(
    'placement-title',
  );
  await expect(title).toHaveText(long);
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );

  await expect(page.getByTestId('calendar-day')).toHaveCount(7);
  await expect.poll(() => columns(page)).toBe(7);
  await page.getByRole('tab', { name: 'Month' }).click();
  await expect
    .poll(() => page.getByTestId('calendar-day').count())
    .toBeGreaterThanOrEqual(28);
  await expect.poll(() => columns(page)).toBe(7);

  // A phone: the same days, one under the other, nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [mode, shown] of [
    ['Month', 28],
    ['Week', 7],
  ] as const) {
    await page.getByRole('tab', { name: mode }).click();
    const n = page.getByTestId('calendar-day');
    if (mode === 'Week') await expect(n).toHaveCount(shown);
    else await expect.poll(() => n.count()).toBeGreaterThanOrEqual(shown);
    await expect.poll(() => columns(page)).toBe(1);
    const ys = (await corners(page)).map(([, y]) => y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    await expect(cell(page, today)).toContainText(label!);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test('calendar: a refused Move to date… keeps the dialog and its date', async ({
  page,
  context,
  account,
  cli,
}) => {
  const today = day();
  // A day of this week, so the week on screen holds both.
  const sunday = new Date().getDay() === 0;
  const target = day(sunday ? -1 : 1);
  const there = sunday ? 1 : 2; // the series stands on a later day too
  const view = await seedView(
    page.request,
    account.token,
    'Week',
    'a0',
    'calendar',
  );
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
  await expect(chip(page, today, 'Water plants')).toBeVisible();

  // The dialog opens on today's occurrence…
  await chip(page, today, 'Water plants')
    .getByRole('button', { name: 'Placement actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Move to date…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Date', { exact: true }).fill(target);

  // …which another tab of the same account marks done meanwhile.
  const other = await context.newPage();
  await other.goto('/?layout=list');
  const row = other.getByTestId('task-row').filter({ hasText: 'Water plants' });
  await row.getByRole('button', { name: 'Mark done' }).click();
  await expect(chip(page, today, 'Water plants')).toHaveCount(1);
  await expect(
    chip(page, today, 'Water plants').getByTestId('placement-title'),
  ).toHaveClass(/line-through/);

  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(
    page.locator('[data-slot="description"]', { hasText: 'undo it first' }),
  ).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue(target);

  // Reopened elsewhere, the same Move goes through and the dialog closes.
  await other.getByRole('button', { name: 'Undo' }).last().click();
  await expect(
    chip(page, today, 'Water plants').getByTestId('placement-title'),
  ).not.toHaveClass(/line-through/);
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(chip(page, target, 'Water plants')).toHaveCount(there);
  await expect(chip(page, today, 'Water plants')).toHaveCount(0);
});

test('calendar: Undo of a moved copy names why it cannot', async ({
  page,
  account,
  cli,
}) => {
  const today = day();
  // A day of this week, so the week on screen holds both.
  const sunday = new Date().getDay() === 0;
  const target = day(sunday ? -1 : 1);
  const there = sunday ? 1 : 2; // the series stands on a later day too
  const view = await seedView(
    page.request,
    account.token,
    'Week',
    'a0',
    'calendar',
  );
  await cli(
    account.token,
    'add',
    'Water plants',
    '--rrule',
    'FREQ=DAILY',
    '--from',
    today,
  );
  type Listed = { id: string; title: string; rrule: string | null };
  const listed = async () =>
    (
      JSON.parse(await cli(account.token, 'list', '--json')) as {
        data: Listed[];
      }
    ).data.filter((t) => t.title === 'Water plants');
  const undo = page.getByRole('button', { name: 'Undo' }).last();
  await page.goto(`/views/${view}`);
  await expect(chip(page, today, 'Water plants')).toBeVisible();

  // A copy with a subtask: the core refuses to delete it with its Undo.
  await chip(page, today, 'Water plants').dragTo(cell(page, target), {
    sourcePosition: { x: 3, y: 3 },
  });
  await undo.hover(); // the toast waits while the pointer is on it
  await expect.poll(async () => (await listed()).length).toBe(2);
  const copy = (await listed()).find((t) => t.rrule === null)!;
  await seedTask(page.request, account.token, {
    title: 'Fetch the can',
    parentId: copy.id,
  });
  await page.getByTestId('sync-now').click();
  await expect(count(page)).toHaveText(tasks(3));
  await undo.click();
  await expect(
    page.locator('[data-slot="description"]', { hasText: 'has subtasks' }),
  ).toBeVisible();
  await expect(chip(page, target, 'Water plants')).toHaveCount(there);
  await expect(chip(page, today, 'Water plants')).toHaveCount(0);

  // The refusal offers the same Undo. With the subtask and the series both
  // deleted elsewhere, it is refused again: the original is gone.
  await undo.hover();
  const pulled = await page.request.post('/api/v1/sync', {
    headers: { authorization: `Bearer ${account.token}` },
    data: { since: 0, ops: [] },
  });
  const { changes } = (await pulled.json()) as {
    changes: {
      table: string;
      id: string;
      row: { version: number; parentId?: string | null };
    }[];
  };
  const original = (await listed()).find((t) => t.rrule !== null)!;
  const gone = await page.request.post('/api/v1/sync', {
    headers: { authorization: `Bearer ${account.token}` },
    data: {
      since: 0,
      ops: changes
        .filter(
          (c) =>
            c.table === 'task' &&
            (c.id === original.id || c.row.parentId === copy.id),
        )
        .map((c) => ({
          opId: crypto.randomUUID(),
          kind: 'delete',
          table: 'task',
          id: c.id,
          baseVersion: c.row.version,
        })),
    },
  });
  expect(gone.status()).toBe(200);
  await page.getByTestId('sync-now').click();
  await expect(count(page)).toHaveText(tasks(1));
  await undo.click();
  await expect(
    page.locator('[data-slot="description"]', { hasText: 'is gone' }),
  ).toBeVisible();
  // That cannot pass any more: no Undo is offered again.
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(chip(page, target, 'Water plants')).toHaveCount(1);
});

test('calendar: Previous, Next and Today keep the keyboard focus', async ({
  page,
  account,
}) => {
  const view = await seedView(
    page.request,
    account.token,
    'Week',
    'a0',
    'calendar',
  );
  await page.goto(`/views/${view}`);
  const title = page.getByTestId('calendar-title');
  await expect(title).toBeVisible();
  const week = await title.innerText();
  for (const name of ['Next', 'Previous', 'Today']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('calendar-skeleton')).toHaveCount(0);
    await expect(button).toBeFocused();
  }
  await expect(title).toHaveText(week);
});

test('calendar: the Week / Month tabs keep text contrast', async ({
  page,
  account,
}) => {
  const view = await seedView(
    page.request,
    account.token,
    'Week',
    'a0',
    'calendar',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`/views/${view}`);
  await expect(page.getByRole('tab', { name: 'Month' })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="calendar"] [role="tablist"]')
    .withRules(['color-contrast'])
    .analyze();
  expect(violations).toEqual([]);
});
