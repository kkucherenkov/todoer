import type { Page } from '@playwright/test';
import {
  arrowTo,
  count,
  day,
  expect,
  projectId,
  seedTask,
  seedView,
  test,
} from './fixtures';

/** Opens a task by URL without a reload: the router follows a popstate. */
const visit = (page: Page, task: string) =>
  page.evaluate((id) => {
    history.pushState(history.state, '', `/?task=${id}`);
    dispatchEvent(
      new PopStateEvent('popstate', { state: history.state as unknown }),
    );
  }, task);

const rows = (page: Page) => page.getByTestId('task-row');

type Listed = {
  id: string;
  title: string;
  notes: string | null;
  priority: number;
  dueOn: string | null;
  project: string | null;
  tags: string[];
  scheduledOn?: string | null;
};

test('list: progressive quick add keeps grammar and structured fields', async ({
  page,
  account,
  cli,
}) => {
  await page.goto('/');
  await expect(count(page)).toBeVisible();

  const input = page.getByRole('textbox', { name: 'Quick add' });
  await expect(page.getByLabel('Project')).toBeHidden();
  const details = page.getByRole('button', { name: 'Add details' });
  // aria-controls must name an element that exists while collapsed.
  const controlled = await details.getAttribute('aria-controls');
  await expect(page.locator(`#${controlled}`)).toHaveCount(1);
  await details.click();
  await expect(page.getByLabel('Project')).toBeVisible();

  await input.fill('Plan trip #home @errand p2');
  await page.getByLabel('Tags').fill('@errand calls');
  await page.getByLabel('Priority').click();
  await page.getByRole('option', { name: 'p0' }).click();
  await page.getByLabel('Scheduled').fill(day(1));
  await page.getByLabel('Due').fill(day(2));
  await page.getByRole('button', { name: 'Add task' }).click();

  const row = rows(page).filter({ hasText: 'Plan trip' });
  await expect(row).toContainText('#home');
  await expect(row).toContainText('@errand');
  await expect(row).toContainText('@calls');
  await expect(row).toContainText('p0');
  await expect(input).toHaveValue('');
  await expect(page.getByLabel('Tags')).toHaveValue('');
  await expect(page.getByLabel('Scheduled')).toHaveValue('');
  await expect(page.getByLabel('Due')).toHaveValue('');

  const listed = async () =>
    (
      JSON.parse(await cli(account.token, 'list', '--json')) as {
        data: Listed[];
      }
    ).data;
  await expect
    .poll(async () =>
      (await listed()).find((task) => task.title === 'Plan trip'),
    )
    .toMatchObject({
      project: 'home',
      tags: ['@calls', '@errand'],
      priority: 0,
      scheduledOn: day(1),
      dueOn: day(2),
    });

  // A chosen project can be handed back to the title's marker.
  await page.getByLabel('Project').click();
  await page.getByRole('option', { name: 'home' }).click();
  await expect(page.getByLabel('Project')).toContainText('home');
  await page.getByLabel('Project').click();
  await page.getByRole('option', { name: 'Use title syntax' }).click();
  await expect(page.getByLabel('Project')).toContainText('Use title syntax');

  // Core refuses marker-only text; every revealed part of the draft stays.
  await input.fill('#home');
  await page.getByLabel('Tags').fill('@keep');
  await page.getByLabel('Due').fill(day(3));
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('alert')).toContainText('That cannot be done.');
  await expect(input).toHaveValue('#home');
  await expect(page.getByLabel('Tags')).toHaveValue('@keep');
  await expect(page.getByLabel('Due')).toHaveValue(day(3));
});

test('list: an out-of-filter quick add links to the task in All open', async ({
  page,
  account,
  cli,
}) => {
  await cli(account.token, 'add', 'Anchor #home');
  const home = await projectId(page.request, account.token, 'home');
  const view = await seedView(
    page.request,
    account.token,
    'Home only',
    'a0',
    'list',
    { project: home },
  );
  await page.goto(`/views/${view}`);
  await expect(count(page)).toBeVisible();

  const input = page.getByRole('textbox', { name: 'Quick add' });
  await input.fill('Outside the filter');
  await input.press('Enter');
  await expect(
    rows(page).filter({ hasText: 'Outside the filter' }),
  ).toHaveCount(0);

  const toast = page.getByText('Added to All open', { exact: true });
  await expect(toast).toBeVisible();
  await page.getByRole('button', { name: 'Open in All open' }).click();
  await expect(page).toHaveURL(/\?task=[0-9a-f-]+$/);
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue(
    'Outside the filter',
  );

  // The view's filter did not leak into the task as a date.
  const listed = (
    JSON.parse(await cli(account.token, 'list', '--json')) as {
      data: Listed[];
    }
  ).data;
  expect(
    listed.find((task) => task.title === 'Outside the filter'),
  ).toMatchObject({ scheduledOn: null, dueOn: null });
});

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
  // The three have no project: their group, below #home's, is where they move.
  const loose = page.getByRole('region', { name: 'No project', exact: true });
  const looseRows = loose.getByTestId('task-row');
  const looseTitles = () => loose.getByTestId('task-title').allTextContents();
  const before = await looseTitles();
  const grip = { x: 3, y: 3 }; // the row's padding: a button would not drag
  await looseRows.nth(2).dragTo(looseRows.nth(0), {
    sourcePosition: grip,
    targetPosition: { x: 20, y: 2 },
  });
  const dropped = [before[2]!, before[0]!, before[1]!];
  await expect.poll(looseTitles).toEqual(dropped);
  await page.reload();
  await expect.poll(looseTitles).toEqual(dropped);

  // A drop into another project's group moves nothing.
  await looseRows.nth(0).dragTo(milk, {
    sourcePosition: grip,
    targetPosition: { x: 20, y: 2 },
  });
  await expect(page.getByTestId('task-title').first()).toHaveText('Buy milk');
  await expect.poll(looseTitles).toEqual(dropped);

  // The keyboard: focus the menu, Enter, arrows to "Move down", Enter.
  await looseRows.nth(0).getByRole('button', { name: 'Task actions' }).focus();
  await page.keyboard.press('Enter');
  const down = page.getByRole('menuitem', { name: 'Move down' });
  await arrowTo(page, down);
  await page.keyboard.press('Enter');
  const moved = [dropped[1]!, dropped[0]!, dropped[2]!];
  await expect.poll(looseTitles).toEqual(moved);
  await page.reload();
  await expect.poll(looseTitles).toEqual(moved);

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
  await drawer.getByText('More details').click();
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
  await drawer.getByText('More details').click();
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

test('list: P0 shows a p0 badge, P4 shows none', async ({
  page,
  account,
  request,
}) => {
  await seedTask(request, account.token, { title: 'Urgent', priority: 0 });
  await seedTask(request, account.token, { title: 'Plain', priority: 4 });
  await page.goto('/');
  const row = (title: string) => rows(page).filter({ hasText: title });
  await expect(row('Urgent')).toContainText('p0');
  await expect(row('Plain')).toBeVisible();
  await expect(row('Plain')).not.toContainText(/\bp\d\b/);
});

/** A project group of the outline, by its heading. */
const group = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });
const row = (page: Page, title: string) =>
  rows(page).filter({ hasText: title });
const toggle = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^Subtasks of ${title}`) });
const context = (page: Page, title: string) =>
  page.getByTestId('child-link').filter({ hasText: title });

test('list: project outline, nested and contextual children, fold', async ({
  page,
  account,
  cli,
  request,
}) => {
  await cli(account.token, 'add', 'Trip #home');
  await cli(account.token, 'add', 'Bills #work');
  await cli(account.token, 'add', 'Loose');
  const home = await projectId(request, account.token, 'home');
  const work = await projectId(request, account.token, 'work');
  const listed = (
    JSON.parse(await cli(account.token, 'list', '--json')) as {
      data: Listed[];
    }
  ).data;
  const trip = listed.find((t) => t.title === 'Trip')!.id;
  await seedTask(request, account.token, {
    title: 'Passport',
    parentId: trip,
    projectId: home,
    rank: 'a1',
  });
  await seedTask(request, account.token, {
    title: 'Car rental',
    parentId: trip,
    projectId: work,
    rank: 'a2',
  });
  await page.goto('/');
  await expect(count(page)).toBeVisible();

  // One group per project by name, No project last; a child of another
  // project nests under its parent once and shows its own project.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'home',
    'work',
    'No project',
  ]);
  const homeGroup = group(page, 'home');
  await expect(homeGroup.getByTestId('group-count')).toHaveText('3 tasks');
  await expect(group(page, 'work').getByTestId('group-count')).toHaveText(
    '1 task',
  );
  await expect(homeGroup.getByTestId('task-title')).toHaveText([
    'Trip',
    'Passport',
    'Car rental',
  ]);
  await expect(row(page, 'Car rental')).toContainText('#work');
  await expect(rows(page).filter({ hasText: 'Car rental' })).toHaveCount(1);
  await expect(toggle(page, 'Trip')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'Trip')).toContainText('0/2');

  // Folding hides the children, not their count; it holds across layouts.
  await toggle(page, 'Trip').click();
  await expect(toggle(page, 'Trip')).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, 'Passport')).toBeHidden();
  await expect(homeGroup.getByTestId('group-count')).toHaveText('3 tasks');
  await page.getByRole('tab', { name: 'Kanban' }).click();
  await expect(toggle(page, 'Trip')).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('tab', { name: 'List' }).click();
  await expect(toggle(page, 'Trip')).toHaveAttribute('aria-expanded', 'false');
  // Folded, the button names how many listed children it hides.
  await expect(toggle(page, 'Trip')).toHaveAccessibleName(/2 hidden/);
  await toggle(page, 'Trip').click();
  await expect(row(page, 'Passport')).toBeVisible();
  await expect(toggle(page, 'Trip')).not.toHaveAccessibleName(/hidden/);
  // A nested row needs no parent link: its parent is right above it.
  await expect(
    row(page, 'Passport').getByRole('button', { name: /^Open parent/ }),
  ).toHaveCount(0);

  // A closed child leaves the rows for a contextual link; its check undoes.
  await row(page, 'Passport')
    .getByRole('button', { name: 'Mark done' })
    .click();
  await expect(row(page, 'Passport')).toHaveCount(0);
  await expect(context(page, 'Passport')).toContainText('Closed');
  await expect(toggle(page, 'Trip')).toContainText('1/2');
  await expect(homeGroup.getByTestId('group-count')).toHaveText('2 tasks');
  await page.getByRole('checkbox', { name: 'Done: Passport' }).click();
  await expect(row(page, 'Passport')).toBeVisible();
  await expect(context(page, 'Passport')).toHaveCount(0);
  await expect(toggle(page, 'Trip')).toContainText('0/2');

  // A project view: the other project's child is outside the filter, and
  // does not count; in the work view the child stands alone, linked.
  const homeView = await seedView(
    request,
    account.token,
    'Home',
    'a0',
    'list',
    {
      project: home,
    },
  );
  const workView = await seedView(
    request,
    account.token,
    'Work',
    'a1',
    'list',
    {
      project: work,
    },
  );
  await page.goto(`/views/${homeView}`);
  await expect(context(page, 'Car rental')).toContainText(
    'Outside this filter',
  );
  await expect(toggle(page, 'Trip')).toContainText('0/2');
  await expect(group(page, 'home').getByTestId('group-count')).toHaveText(
    '2 tasks',
  );
  await page.goto(`/views/${workView}`);
  await expect(group(page, 'work').getByTestId('task-title')).toHaveText([
    'Bills',
    'Car rental',
  ]);
  await expect(
    row(page, 'Car rental').getByRole('button', { name: 'Open parent: Trip' }),
  ).toBeVisible();
});

test('list: a contextual child of a recurring parent is on its occurrence', async ({
  page,
  account,
  cli,
  request,
}) => {
  await cli(
    account.token,
    'add',
    'Weekly review #home',
    '--rrule',
    'FREQ=WEEKLY',
    '--from',
    day(),
  );
  const home = await projectId(request, account.token, 'home');
  const weekly = (
    JSON.parse(await cli(account.token, 'list', '--json')) as {
      data: Listed[];
    }
  ).data.find((t) => t.title === 'Weekly review')!.id;
  // No project: outside the home view.
  await seedTask(request, account.token, {
    title: 'Inbox zero',
    parentId: weekly,
  });
  const view = await seedView(request, account.token, 'Home', 'a0', 'list', {
    project: home,
  });
  await page.goto(`/views/${view}`);
  await expect(context(page, 'Inbox zero')).toContainText(
    'Outside this filter',
  );
  await page.getByRole('checkbox', { name: 'Done: Inbox zero' }).click();
  await expect(toggle(page, 'Weekly review')).toContainText('1/1');
  await expect(context(page, 'Inbox zero')).toContainText('Closed');

  // The next occurrence starts the checklist over.
  await cli(account.token, 'done', weekly);
  await page.getByTestId('sync-now').click();
  await expect(row(page, 'Weekly review').getByTestId('occurrence')).toHaveText(
    day(7),
  );
  await expect(toggle(page, 'Weekly review')).toContainText('0/1');
});

test('list: indent and outdent through reparent', async ({
  page,
  account,
  cli,
}) => {
  const listed = async () =>
    (
      JSON.parse(await cli(account.token, 'list', '--json')) as {
        data: (Listed & { parentId: string | null })[];
      }
    ).data;
  await cli(account.token, 'add', 'First');
  await cli(account.token, 'add', 'Second');
  await page.goto('/');
  await expect(page.getByTestId('task-title')).toHaveText(['First', 'Second']);

  // The first row has nothing above to go under.
  await row(page, 'First')
    .getByRole('button', { name: 'Task actions' })
    .click();
  await expect(
    page.getByRole('menuitem', { name: /^Make subtask of/ }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');

  await row(page, 'Second')
    .getByRole('button', { name: 'Task actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Make subtask of First' }).click();
  await expect(toggle(page, 'First')).toContainText('0/1');
  await expect
    .poll(async () => {
      const all = await listed();
      return (
        all.find((t) => t.title === 'Second')?.parentId ===
        all.find((t) => t.title === 'First')?.id
      );
    })
    .toBe(true);

  await row(page, 'Second')
    .getByRole('button', { name: 'Task actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Make top-level' }).click();
  await expect(toggle(page, 'First')).toHaveCount(0);
  await expect
    .poll(
      async () => (await listed()).find((t) => t.title === 'Second')?.parentId,
    )
    .toBeNull();
});

test('list: a subtask added under a folded parent unfolds it', async ({
  page,
  account,
  cli,
  request,
}) => {
  await cli(account.token, 'add', 'Trip');
  const trip = (
    JSON.parse(await cli(account.token, 'list', '--json')) as {
      data: Listed[];
    }
  ).data[0]!.id;
  await seedTask(request, account.token, { title: 'Passport', parentId: trip });
  await page.goto('/');
  await toggle(page, 'Trip').click();
  await expect(toggle(page, 'Trip')).toHaveAttribute('aria-expanded', 'false');

  await page.getByRole('button', { name: 'Trip', exact: true }).click();
  const add = page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Add subtask' });
  await add.fill('Tickets');
  await add.press('Enter');
  await expect(add).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(toggle(page, 'Trip')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'Tickets')).toBeVisible();
});
