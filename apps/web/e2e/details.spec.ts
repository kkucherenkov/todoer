import type { Page } from '@playwright/test';
import { count, day, expect, seedTask, tasks, test } from './fixtures';

const row = (page: Page, title: string) =>
  page
    .getByTestId('task-row')
    .filter({ has: page.getByTestId('task-title').filter({ hasText: title }) });
const openRow = (page: Page, title: string) =>
  row(page, title).getByTestId('task-title').click();
// CSS, not role: an open modal hides the drawer from the role tree.
const drawer = (page: Page) => page.locator('[role="dialog"]').first();
const nested = (page: Page) => page.locator('[role="dialog"]').last();
const more = (page: Page) => drawer(page).getByText('More details');
const focusedInside = (page: Page) =>
  nested(page).evaluate((d) => d.contains(document.activeElement));

test('details: title and notes lead, more details are remembered, saves are said', async ({
  page,
  account,
  cli,
}) => {
  await cli(account.token, 'add', 'Plan trip #home p2');
  await cli(account.token, 'add', 'Book hotel');
  await page.goto('/');
  await openRow(page, 'Plan trip');

  const d = drawer(page);
  // Past the loading skeleton, which has no labels.
  await expect(d.getByLabel('Title')).toHaveValue('Plan trip');
  const labels = await d
    .locator('label')
    .evaluateAll((l) => l.map((e) => e.textContent?.trim()));
  expect(labels.slice(0, 4)).toEqual(['Title', 'Notes', 'Scheduled', 'Due']);
  await expect(d.getByRole('button', { name: 'Project' })).toBeHidden();
  await expect(d.getByTestId('save-status')).toHaveText(
    'Changes save when you leave a field.',
  );

  await d.getByLabel('Notes').fill('Check visas');
  await d.getByLabel('Notes').blur();
  await expect(d.getByTestId('save-status')).toContainText(
    'Saved on this device',
  );

  await more(page).click();
  await expect(d.getByRole('button', { name: 'Project' })).toContainText(
    'home',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The next task opens with the details still shown.
  await openRow(page, 'Book hotel');
  await expect(d.getByRole('button', { name: 'Project' })).toBeVisible();
});

test('details: a subtask has no rule of its own', async ({
  page,
  account,
  cli,
}) => {
  const json = async (...args: string[]) =>
    (
      JSON.parse(await cli(account.token, ...args, '--json')) as {
        data: { id: string };
      }
    ).data.id;
  const standup = await json(
    'add',
    'Standup',
    '--rrule',
    'FREQ=DAILY',
    '--from',
    day(),
  );
  await seedTask(page.request, account.token, {
    title: 'Notes',
    parentId: standup,
  });
  await page.goto('/');
  await openRow(page, 'Notes');

  const d = drawer(page);
  // Scheduled by the parent's rule: the occurrence, not an input.
  await expect(d.getByTestId('rule')).toContainText(day());
  await expect(d.getByTestId('rule')).toContainText('Repeats with its parent');
  await expect(d.getByLabel('Scheduled', { exact: true })).toHaveCount(0);
  await more(page).click();
  await expect(d.getByRole('button', { name: 'Repeat…' })).toBeDisabled();
  await expect(d).toContainText('Subtasks cannot have their own repeat rule.');
  await page.keyboard.press('Escape');
});

/** Drops the next write of `kind` and answers it with a refusal, as when the
 *  worker never got it, and records every write the tab sends. The tab's
 *  channel never hears itself, so the reply is handed to its handler. */
const refuseNext = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as {
      sent: { kind: string; opId: string }[];
      refuse: string | null;
    };
    w.sent = [];
    w.refuse = null;
    const Real = BroadcastChannel;
    class Spy extends Real {
      handler: ((e: MessageEvent) => void) | null = null;
      leader: unknown;
      override set onmessage(h: ((e: MessageEvent) => void) | null) {
        this.handler = h;
        super.onmessage = (e: MessageEvent) => {
          this.leader = (e.data as { leader?: unknown }).leader;
          h?.(e);
        };
      }
      override postMessage(m: {
        type?: string;
        id?: number;
        tab?: string;
        build?: string;
        command?: { kind: string; opId?: string };
      }) {
        const c = m.command;
        if (m.type === 'request' && c?.opId) {
          w.sent.push({ kind: c.kind, opId: c.opId });
        }
        if (m.type === 'request' && c?.kind === w.refuse) {
          w.refuse = null;
          const { id, tab, build } = m;
          this.handler?.({
            data: {
              type: 'reply',
              id,
              tab,
              build,
              leader: this.leader,
              result: {
                ok: false,
                failure: { kind: 'refused', detail: 'late answer' },
              },
            },
          } as MessageEvent);
          return;
        }
        super.postMessage(m);
      }
    }
    window.BroadcastChannel = Spy;
  });

/** The opIds of the writes of `kind` the tab sent, in order. */
const opIds = (page: Page, kind: string) =>
  page.evaluate(
    (k) =>
      (window as unknown as { sent: { kind: string; opId: string }[] }).sent
        .filter((w) => w.kind === k)
        .map((w) => w.opId),
    kind,
  );

test('details: a refused change is kept and retried as the same write', async ({
  page,
  account,
  cli,
}) => {
  await cli(account.token, 'add', 'Report');
  await refuseNext(page);
  await page.goto('/');
  await openRow(page, 'Report');
  const d = drawer(page);
  const due = d.getByLabel('Due', { exact: true });
  await page.evaluate(
    () => ((window as unknown as { refuse: string }).refuse = 'edit'),
  );
  await due.fill(day(2));
  await due.blur();
  const refused = d.getByTestId('refused');
  await expect(refused).toContainText(`Your change: ${day(2)}`);
  await expect(refused).toContainText('Saved value: No date');
  await expect(refused).toContainText(
    'The server refused the request. late answer',
  );
  await expect(due).toHaveValue('');

  await refused.getByRole('button', { name: 'Retry change' }).click();
  await expect(refused).toHaveCount(0);
  await expect(due).toHaveValue(day(2));
  await expect(d.getByTestId('save-status')).toContainText(
    'Saved on this device',
  );
  const edits = await page.evaluate(() =>
    (window as unknown as { sent: { kind: string; opId: string }[] }).sent
      .filter((w) => w.kind === 'edit')
      .map((w) => w.opId),
  );
  expect(edits).toHaveLength(2);
  expect(edits[1]).toBe(edits[0]);
  await expect
    .poll(
      async () =>
        (
          JSON.parse(await cli(account.token, 'list', '--json')) as {
            data: { title: string; dueOn: string | null }[];
          }
        ).data.find((t) => t.title === 'Report')?.dueOn,
    )
    .toBe(day(2));
});

test('details: delete names its subtasks, shows progress, keeps a refusal', async ({
  page,
  context,
  account,
  cli,
}) => {
  await cli(account.token, 'add', 'Synced');
  await refuseNext(page); // records only: nothing is refused here
  await page.goto('/');
  await expect(count(page)).toHaveText(tasks(1));

  await context.setOffline(true);
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('offline')).toBeVisible({ timeout: 15_000 });
  const input = page.getByRole('textbox', { name: 'Quick add' });
  await input.fill('Fresh');
  await input.press('Enter');
  await openRow(page, 'Fresh');
  await page.getByTestId('delete-task').click();
  const dialog = nested(page);
  await expect(dialog).toContainText('This cannot be undone.');
  await dialog.getByTestId('confirm-delete').click();
  // Not synced yet: the dialog stays with the reason.
  await expect(dialog.getByRole('alert')).toContainText('not synced yet');
  await expect(row(page, 'Fresh')).toBeVisible();

  // Back online the tab syncs by itself.
  await context.setOffline(false);
  await expect(page.getByTestId('pending')).toHaveCount(0, {
    timeout: 15_000,
  });
  await dialog.getByTestId('confirm-delete').click();
  await expect(page.getByText('Task deleted', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(row(page, 'Fresh')).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
  // Confirming again resent the refused write, not a new one.
  const deletes = await opIds(page, 'deleteTask');
  expect(deletes).toHaveLength(2);
  expect(deletes[1]).toBe(deletes[0]);
});

test('details: a subtask of an ended series keeps a refused date', async ({
  page,
  account,
  cli,
}) => {
  const old = (
    JSON.parse(
      await cli(
        account.token,
        'add',
        'Old series',
        '--rrule',
        'FREQ=DAILY;COUNT=1',
        '--from',
        day(),
        '--json',
      ),
    ) as { data: { id: string } }
  ).data.id;
  await seedTask(page.request, account.token, {
    title: 'Leftover',
    parentId: old,
  });
  // Its one occurrence done: the subtask has no occurrence left.
  await page.goto(`/?task=${old}`);
  await drawer(page).getByRole('checkbox', { name: 'Done: Leftover' }).click();
  await expect(drawer(page).getByTestId('progress')).toHaveText('1 of 1 done');
  await drawer(page)
    .getByRole('button', { name: 'Leftover', exact: true })
    .click();
  const d = drawer(page);
  await expect(d.getByLabel('Title')).toHaveValue('Leftover');
  // No occurrence left, so a date input — which the core refuses (tuxedo 514).
  const scheduled = d.getByLabel('Scheduled', { exact: true });
  await scheduled.fill(day(1));
  await scheduled.blur();
  const refused = d.getByTestId('refused');
  await expect(refused).toContainText(`Your change: ${day(1)}`);
  await expect(refused).toContainText(
    'a recurring task is scheduled by its rule',
  );
  await expect(scheduled).toHaveValue('');
});

test('details: a refused repeat and return to series resend the same write', async ({
  page,
  account,
  cli,
}) => {
  await cli(account.token, 'add', 'Gym');
  const water = (
    JSON.parse(
      await cli(
        account.token,
        'add',
        'Water',
        '--rrule',
        'FREQ=DAILY',
        '--from',
        day(),
        '--json',
      ),
    ) as { data: { id: string } }
  ).data.id;
  const copy = await seedTask(page.request, account.token, {
    title: 'Water',
    originTaskId: water,
    originOccurrence: day(),
    scheduledOn: day(1),
  });
  await refuseNext(page);
  await page.goto('/');
  const refuse = (kind: string) =>
    page.evaluate(
      (k) => ((window as unknown as { refuse: string }).refuse = k),
      kind,
    );

  // Repeat: the form stays open, Save again sends the same setRule.
  await openRow(page, 'Gym');
  await more(page).click();
  await drawer(page).getByRole('button', { name: 'Repeat…' }).click();
  const form = nested(page);
  await form.getByRole('combobox', { name: 'Repeat' }).click();
  await page.getByRole('option', { name: 'Daily' }).click();
  await refuse('setRule');
  await form.getByRole('button', { name: 'Save' }).click();
  // Exact: the toast also announces its text in a hidden live region.
  await expect(
    page.getByText('late answer', { exact: true }).last(),
  ).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(2);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(drawer(page).getByTestId('rule')).toContainText('FREQ=DAILY');
  const rules = await opIds(page, 'setRule');
  expect(rules).toHaveLength(2);
  expect(rules[1]).toBe(rules[0]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Return to series: the drawer stays, the second press sends the same undoMove.
  await page.goto(`/?task=${copy}`);
  await refuse('undoMove');
  const back = drawer(page).getByRole('button', { name: 'Return to series' });
  await back.click();
  await expect(
    page.getByText('late answer', { exact: true }).last(),
  ).toBeVisible();
  await expect(page).toHaveURL(/task=/);
  await back.click();
  await expect(page).not.toHaveURL(/task=/);
  const undos = await opIds(page, 'undoMove');
  expect(undos).toHaveLength(2);
  expect(undos[1]).toBe(undos[0]);
});

test('details: navigation keeps the query, nested dialogs keep the focus', async ({
  page,
  account,
  cli,
}) => {
  await cli(account.token, 'add', 'Parent');
  await page.goto('/');
  await openRow(page, 'Parent');
  const add = drawer(page).getByRole('textbox', { name: 'Add subtask' });
  await add.fill('Child');
  await add.press('Enter');
  await expect(
    drawer(page).getByRole('checkbox', { name: 'Done: Child' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/?layout=kanban');
  // The child's own card (it links its parent); the parent's card lists
  // the child too.
  const card = page
    .getByTestId('card')
    .filter({ has: page.getByTestId('parent-link') });
  await card.getByText('Child', { exact: true }).click();
  await drawer(page).getByTestId('subtask-of').click();
  await expect(drawer(page).getByLabel('Title')).toHaveValue('Parent');
  await drawer(page)
    .getByRole('button', { name: 'Child', exact: true })
    .click();
  await expect(drawer(page).getByLabel('Title')).toHaveValue('Child');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\?layout=kanban$/);
  await expect(card).toBeFocused();

  // Delete over the drawer: Tab and Shift+Tab stay in it, Escape closes it
  // alone and returns to its trigger.
  await page.goto('/');
  await openRow(page, 'Parent');
  await page.getByTestId('delete-task').click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(2);
  for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await focusedInside(page)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(page.getByTestId('delete-task')).toBeFocused();

  // Repeat, likewise.
  await more(page).click();
  const repeat = drawer(page).getByRole('button', { name: 'Repeat…' });
  await repeat.click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(2);
  for (const key of ['Shift+Tab', 'Shift+Tab', 'Tab']) {
    await page.keyboard.press(key);
    expect(await focusedInside(page)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(repeat).toBeFocused();
});

test('details: focus goes to the nearest task when the opener leaves', async ({
  page,
  account,
  cli,
}) => {
  for (const title of ['One', 'Two', 'Three']) {
    await cli(account.token, 'add', title);
  }
  await page.goto('/');
  await expect(count(page)).toHaveText(tasks(3));
  await openRow(page, 'Two');
  await more(page).click();
  await drawer(page).getByRole('button', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await expect(row(page, 'Two')).toHaveCount(0);
  // An Escape during the menu's close animation is the menu's.
  await expect(
    drawer(page).getByRole('button', { name: 'Status' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.locator('[data-testid="task-title"][data-task-opener]:focus'),
  ).toHaveCount(1);
});
