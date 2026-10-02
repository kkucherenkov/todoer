import type { Page } from '@playwright/test';
import {
  count,
  day,
  expect,
  seedTask,
  seedView,
  tasks,
  test,
} from './fixtures';

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
  await expect(page.getByTestId('delete-task')).toBeFocused();

  // Delete, then confirm: all three go.
  await page.getByTestId('delete-task').click();
  await dialog(page).last().getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Task deleted', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/task=/);
  // Settled: the sync is done and the drawer's own toast would have shown.
  await expect(page.getByTestId('pending')).toHaveCount(0);
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
  // Cancel has the focus: Enter alone deletes nothing and returns to Delete.
  await expect(
    dialog(page).last().getByRole('button', { name: 'Cancel' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(del).toBeFocused();
  await expect(row(page, 'Lone')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('confirm-delete')).toBeFocused();
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

test('editing: subtasks in the drawer and as rows', async ({
  page,
  account,
  cli,
}) => {
  type Listed = {
    id: string;
    title: string;
    parentId: string | null;
    project: string | null;
  };
  const listed = async () =>
    (
      JSON.parse(await cli(account.token, 'list', '--json')) as {
        data: Listed[];
      }
    ).data;
  const drawer = page.getByRole('dialog');
  const progress = drawer.getByTestId('progress');
  const check = (title: string) =>
    drawer.getByRole('checkbox', { name: `Done: ${title}` });

  await cli(account.token, 'add', 'Clean kitchen #house');
  await page.goto('/');
  await row(page, 'Clean kitchen').getByTestId('task-title').click();
  const add = drawer.getByRole('textbox', { name: 'Add subtask' });
  await add.fill('Dishes');
  await add.press('Enter');
  await expect(check('Dishes')).toBeVisible();
  await expect(add).toHaveValue('');
  await add.fill('Floor #garage');
  await add.press('Enter');
  await expect(check('Floor')).toBeVisible();
  await expect(progress).toHaveText('0 of 2 done');

  await expect
    .poll(async () => {
      const all = await listed();
      const kitchen = all.find((t) => t.title === 'Clean kitchen');
      const sub = (title: string) => all.find((t) => t.title === title);
      return [
        sub('Dishes')?.parentId === kitchen?.id,
        sub('Floor')?.parentId === kitchen?.id,
        sub('Dishes')?.project,
        sub('Floor')?.project,
      ];
    })
    .toEqual([true, true, 'house', 'garage']);

  await check('Dishes').click();
  await expect(progress).toHaveText('1 of 2 done');

  // A subtask is an ordinary row, with a link to its parent.
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(row(page, 'Floor')).toBeVisible();
  await expect(row(page, 'Dishes')).toHaveCount(0);
  const link = row(page, 'Floor').getByRole('button', {
    name: 'Open parent: Clean kitchen',
  });
  await link.click();
  await expect(drawer.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Clean kitchen',
  );
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  await row(page, 'Floor').getByTestId('task-title').click();
  await expect(drawer).toContainText('Subtask of Clean kitchen');
  await expect(
    drawer.getByRole('textbox', { name: 'Add subtask' }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  // A board shows the same link.
  const board = await seedView(page.request, account.token, 'Board', 'a0');
  await page.goto(`/views/${board}`);
  const card = page.getByTestId('card').filter({ hasText: 'Floor' });
  await expect(
    card.getByRole('button', { name: 'Open parent: Clean kitchen' }),
  ).toBeVisible();

  // A recurring parent: the checklist is on its current occurrence.
  await page.goto('/');
  const weekly = (
    JSON.parse(
      await cli(
        account.token,
        'add',
        'Weekly review',
        '--rrule',
        'FREQ=WEEKLY',
        '--from',
        day(),
        '--json',
      ),
    ) as { data: { id: string } }
  ).data.id;
  await page.getByTestId('sync-now').click();
  await row(page, 'Weekly review').getByTestId('task-title').click();
  await add.fill('Inbox zero');
  await add.press('Enter');
  await expect(check('Inbox zero')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  await cli(account.token, 'done', weekly);
  await page.getByTestId('sync-now').click();
  await expect(row(page, 'Weekly review').getByTestId('occurrence')).toHaveText(
    day(7),
  );
  await row(page, 'Weekly review').getByTestId('task-title').click();
  await expect(progress).toHaveText('0 of 1 done');
  await check('Inbox zero').click();
  await expect(progress).toHaveText('1 of 1 done');
  await page.reload();
  await expect(progress).toHaveText('1 of 1 done');
  await expect(check('Inbox zero')).toBeChecked();
});

test('editing: recurrence', async ({ page, account, cli }) => {
  type Listed = {
    title: string;
    rrule: string | null;
    dtstart: string | null;
    scheduledOn: string | null;
  };
  const listed = async (title: string) =>
    (
      JSON.parse(await cli(account.token, 'list', '--json')) as {
        data: Listed[];
      }
    ).data.find((t) => t.title === title);
  // CSS, not role: an open modal hides the drawer from the role tree.
  const drawer = page.locator('[role="dialog"]').first();
  const form = page.locator('[role="dialog"]').last();
  const save = form.getByRole('button', { name: 'Save' });
  const problem = form.getByTestId('rule-problem');
  const dates = form.getByTestId('rule-preview').locator('time');
  const repeat = form.getByRole('combobox', { name: 'Repeat' });
  const rule = form.getByRole('textbox', { name: 'RRULE' });
  const every = form.getByRole('spinbutton', { name: 'Every' });
  const choose = async (mode: string) => {
    await repeat.click();
    await page.getByRole('option', { name: mode }).click();
  };
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const tick = async (...on: string[]) => {
    for (const d of weekdays) {
      await form.getByRole('checkbox', { name: d }).setChecked(on.includes(d));
    }
  };
  const open = async (title: string) => {
    await row(page, title).getByTestId('task-title').click();
    await expect(drawer.getByRole('textbox', { name: 'Title' })).toHaveValue(
      title,
    );
  };
  const closeDrawer = async () => {
    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };

  const monday = day(7 - ((new Date().getDay() + 6) % 7));
  const wednesday = day(9 - ((new Date().getDay() + 6) % 7));
  await seedTask(page.request, account.token, {
    title: 'Gym',
    scheduledOn: day(1),
  });
  await page.goto('/');
  await open('Gym');

  // One-off to weekly: the form previews what Save will write.
  await drawer.getByRole('button', { name: 'Repeat…' }).click();
  await choose('Weekly');
  await tick('Mon', 'Wed');
  await every.fill('2');
  await every.press('Tab');
  await form.getByLabel('Starts').fill(monday);
  await expect(dates.nth(0)).toHaveAttribute('datetime', monday);
  await expect(dates.nth(1)).toHaveAttribute('datetime', wednesday);
  await save.click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(drawer.getByTestId('rule')).toContainText(
    'Repeats: FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
  );
  await expect
    .poll(() => listed('Gym'))
    .toMatchObject({
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      dtstart: monday,
      scheduledOn: null,
    });

  // Reopened, the form shows the rule and nothing to save.
  await drawer.getByRole('button', { name: 'Edit repeat…' }).click();
  await expect(repeat).toHaveText('Weekly');
  await expect(form.getByRole('checkbox', { name: 'Mon' })).toBeChecked();
  await expect(form.getByRole('checkbox', { name: 'Wed' })).toBeChecked();
  await expect(form.getByRole('checkbox', { name: 'Tue' })).not.toBeChecked();
  await expect(every).toHaveValue('2');
  await expect(save).toBeDisabled();

  await tick();
  await expect(problem).toHaveText('Pick at least one day');
  await expect(save).toBeDisabled();

  // The raw field.
  await choose('Custom (RRULE)');
  await rule.fill('FREQ=HOURLY');
  await expect(problem).toBeVisible();
  await expect(save).toBeDisabled();
  await rule.fill('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30');
  await expect(problem).toContainText('produces no date');
  await rule.fill('FREQ=MONTHLY;BYDAY=1MO');
  await expect(problem).toHaveCount(0);
  await expect(dates).toHaveCount(5);
  for (const d of await dates.evaluateAll((l) =>
    l.map((e) => e.getAttribute('datetime')),
  )) {
    const at = new Date(`${d}T00:00:00Z`);
    expect([at.getUTCDay(), at.getUTCDate() <= 7]).toEqual([1, true]);
  }
  await save.click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect
    .poll(() => listed('Gym'))
    .toMatchObject({ rrule: 'FREQ=MONTHLY;BYDAY=1MO', dtstart: monday });
  await drawer.getByRole('button', { name: 'Edit repeat…' }).click();
  await expect(repeat).toHaveText('Custom (RRULE)');
  await expect(rule).toHaveValue('FREQ=MONTHLY;BYDAY=1MO');

  // Back to one-off: the date it was showing becomes the scheduled date.
  const shown = /\d{4}-\d{2}-\d{2}/.exec(
    (await drawer.getByTestId('rule').textContent()) ?? '',
  )?.[0];
  expect(shown).toBeTruthy();
  await choose('Does not repeat');
  await save.click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(drawer.getByLabel('Scheduled', { exact: true })).toHaveValue(
    shown!,
  );
  await expect
    .poll(() => listed('Gym'))
    .toMatchObject({ rrule: null, dtstart: null, scheduledOn: shown });
  await closeDrawer();

  // What the CLI writes opens in the right mode.
  await cli(
    account.token,
    'add',
    'Stretch',
    '--rrule',
    'FREQ=DAILY',
    '--from',
    day(),
  );
  await cli(
    account.token,
    'add',
    'Walk',
    '--rrule',
    'FREQ=WEEKLY',
    '--from',
    day(),
  );
  await page.getByTestId('sync-now').click();
  await open('Stretch');
  await drawer.getByRole('button', { name: 'Edit repeat…' }).click();
  await expect(repeat).toHaveText('Daily');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(
    drawer.getByRole('button', { name: 'Edit repeat…' }),
  ).toBeFocused();
  await closeDrawer();
  await open('Walk');
  await drawer.getByRole('button', { name: 'Edit repeat…' }).click();
  await expect(repeat).toHaveText('Custom (RRULE)');
  await expect(rule).toHaveValue('FREQ=WEEKLY');
  await form.getByRole('button', { name: 'Cancel' }).click();
  await closeDrawer();

  // A subtask repeats with its parent.
  const move = await seedTask(page.request, account.token, { title: 'Move' });
  await seedTask(page.request, account.token, {
    title: 'Pack',
    parentId: move,
  });
  await page.reload();
  await open('Pack');
  await expect(drawer).toContainText('Subtask of Move');
  await expect(drawer.getByRole('button', { name: 'Repeat…' })).toHaveCount(0);
  await expect(
    drawer.getByRole('button', { name: 'Edit repeat…' }),
  ).toHaveCount(0);
});
