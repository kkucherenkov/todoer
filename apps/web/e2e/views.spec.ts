import { count, expect, seedView, test } from './fixtures';

test('view form: create, edit, raw JSON, delete', async ({
  page,
  account,
  cli,
}) => {
  const viewNames = async () =>
    (
      JSON.parse(await cli(account.token, 'views', '--json')) as {
        data: { name: string; layout: string; sort: string }[];
      }
    ).data.map(({ name, layout, sort }) => ({ name, layout, sort }));
  await cli(account.token, 'add', 'Sweep #home');
  await cli(account.token, 'add', 'Call mum');
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Views' });
  const dialog = page.getByRole('dialog');
  const pick = async (trigger: string, option: string) => {
    await dialog.getByTestId(trigger).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };

  // Create: Project… #home, list, sorted by due date.
  await page.getByTestId('new-view').click();
  await dialog.getByTestId('view-name').fill('Home');
  await dialog.getByTestId('start-from').click();
  await page.getByRole('menuitem', { name: 'Project…', exact: true }).click();
  await pick('value-n', 'home');
  await pick('view-sort', 'Due date');
  await dialog.getByTestId('view-save').click();
  await expect(
    nav.getByRole('link', { name: 'Home', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/views\/[0-9a-f-]+$/);
  await expect(page.getByTestId('task-title')).toHaveText(['Sweep']);
  await expect
    .poll(viewNames)
    .toEqual([{ name: 'Home', layout: 'list', sort: 'due' }]);

  // Edit: the same view as a board.
  await page.getByTestId('edit-view').click();
  await expect(dialog.getByTestId('view-name')).toHaveValue('Home');
  await dialog.getByRole('radio', { name: 'Kanban' }).click();
  await dialog.getByTestId('view-save').click();
  await expect(page.getByTestId('column-name').first()).toBeVisible();
  await expect
    .poll(viewNames)
    .toEqual([{ name: 'Home', layout: 'kanban', sort: 'due' }]);

  // Raw JSON: the server's own message, and no Save.
  await page.getByTestId('edit-view').click();
  await dialog.getByTestId('view-raw').click();
  await dialog.getByTestId('view-filter').fill('{"tag":"Work"}');
  await expect(dialog.getByTestId('filter-problem')).toHaveText(
    'filter.tag: not a uuid',
  );
  await expect(dialog.getByTestId('view-save')).toBeDisabled();
  await dialog.getByTestId('view-filter').fill('{"tag":');
  await expect(dialog.getByTestId('filter-problem')).toBeVisible();
  await expect(dialog.getByTestId('view-save')).toBeDisabled();
  await page.keyboard.press('Escape');

  // Delete: confirmed, gone from the sidebar and from the CLI. A double
  // click sends one delete: a second would be refused as a missing view.
  await page.getByTestId('delete-view').click();
  await page.getByTestId('confirm-delete').dblclick();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    nav.getByRole('link', { name: 'Home', exact: true }),
  ).toHaveCount(0);
  await expect.poll(async () => (await viewNames()).length).toBe(0);
  await expect(page.getByText('That cannot be done.')).toHaveCount(0);
});

test('view form: filter tree', async ({
  page,
  account,
  cli,
  request,
  context,
}) => {
  await cli(account.token, 'add', 'Buy milk #home @errand');
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Views' });
  const dialog = page.getByRole('dialog');
  const limits = dialog.getByTestId('filter-limits');
  const problem = dialog.getByTestId('filter-problem');
  const save = dialog.getByTestId('view-save');
  const filterText = () => dialog.getByTestId('view-filter').inputValue();
  const choose = async (trigger: string, option: string) => {
    await dialog.getByTestId(trigger).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const menu = async (trigger: string, item: string) => {
    await dialog.getByTestId(trigger).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
  };
  /** Saves with the network down, so a queued op stays visible as pending. */
  const saveUnchanged = async () => {
    await context.setOffline(true);
    await save.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('pending')).toHaveCount(0);
    await context.setOffline(false);
  };

  // Start from a template, then grow the tree by hand.
  await page.getByTestId('new-view').click();
  await dialog.getByTestId('view-name').fill('Tree');
  await menu('start-from', 'Next 7 days');
  await expect(dialog.getByTestId('op-n')).toHaveText('Any of');
  await expect(dialog.getByTestId('node-n-0')).toContainText('Scheduled');
  await expect(dialog.getByTestId('node-n-1')).toContainText('Due');
  await menu('add-n', 'Group');
  await choose('op-n-2', 'All of');
  await menu('add-n-2', 'Tag');
  await dialog.getByTestId('not-n-2-0').click();
  await menu('add-n-2', 'Priority');
  await expect(
    dialog.getByTestId('value-n-2-1').getByRole('checkbox', { name: 'p0' }),
  ).toBeChecked();
  await expect(
    dialog.getByTestId('value-n-2-1').getByRole('checkbox', { name: 'p1' }),
  ).not.toBeChecked();
  await expect(limits).toHaveText('7/256 conditions · depth 4/8');

  // Deselecting all priorities invalidates the filter and disables Save.
  await dialog
    .getByTestId('value-n-2-1')
    .getByRole('checkbox', { name: 'p0' })
    .click();
  await expect(problem).toBeVisible();
  await expect(save).toBeDisabled();
  await dialog
    .getByTestId('value-n-2-1')
    .getByRole('checkbox', { name: 'p0' })
    .click();
  await expect(problem).toHaveCount(0);
  await expect(save).toBeEnabled();

  // The same tree as JSON, with the errand tag's lower-case id and [0] priority.
  await dialog.getByTestId('view-raw').click();
  const tree = {
    or: [
      { scheduled: { from: 0, to: 6 } },
      { due: { from: 0, to: 6 } },
      {
        and: [
          { not: { tag: expect.stringMatching(/^[0-9a-f-]{36}$/) } },
          { priority: [0] },
        ],
      },
    ],
  };
  expect(JSON.parse(await filterText())).toEqual(tree);
  await dialog.getByTestId('view-raw').click();
  await expect(dialog.getByTestId('value-n-2-0')).toHaveText('@errand');

  // An incomplete leaf is a problem and blocks Save until it is gone.
  await menu('add-n', 'Due');
  await choose('from-kind-n-3', 'Date');
  await expect(problem).toBeVisible();
  await expect(save).toBeDisabled();
  await dialog.getByTestId('remove-n-3').click();
  await expect(problem).toHaveCount(0);
  await expect(save).toBeEnabled();

  // Calendar layout, saved.
  await dialog.getByRole('radio', { name: 'Calendar' }).click();
  await save.click();
  await expect(nav.getByRole('link', { name: 'Tree' })).toBeVisible();
  await expect(
    nav
      .getByRole('link', { name: 'Tree' })
      .locator('[class*="lucide"][class*="calendar"]'),
  ).toHaveCount(1);
  await expect
    .poll(async () =>
      (
        JSON.parse(await cli(account.token, 'views', '--json')) as {
          data: { name: string; layout: string }[];
        }
      ).data.map(({ name, layout }) => ({ name, layout })),
    )
    .toEqual([{ name: 'Tree', layout: 'calendar' }]);

  // Edit shows the same tree; Save without a change queues nothing.
  await page.getByTestId('edit-view').click();
  await expect(dialog.getByTestId('op-n-2')).toHaveText('All of');
  await expect(limits).toHaveText('7/256 conditions · depth 4/8');
  await dialog.getByTestId('view-raw').click();
  expect(JSON.parse(await filterText())).toEqual(tree);
  await dialog.getByTestId('view-raw').click();
  await saveUnchanged();

  // A leaf naming an id the catalog lacks is shown, and kept.
  const ghost = await seedView(request, account.token, 'Ghost', 'a1', 'list', {
    tag: crypto.randomUUID(),
  });
  await page.goto(`/views/${ghost}`);
  await page.getByTestId('edit-view').click();
  await expect(dialog.getByTestId('value-n')).toHaveText('Unknown (deleted?)');
  await saveUnchanged();
});

test('view form: a refused save keeps the form and says why', async ({
  page,
  account,
  context,
  browserName,
}) => {
  // Firefox does not route a dedicated worker's fetch.
  test.skip(browserName !== 'chromium', 'needs the worker routed');
  void account; // signed in
  await page.goto('/');
  await expect(count(page)).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Views' });
  const dialog = page.getByRole('dialog');
  const refusal = dialog.getByTestId('view-refusal');

  await page.getByTestId('new-view').click();
  await dialog.getByTestId('view-name').fill('Refused');
  await dialog.getByRole('radio', { name: 'Kanban' }).click();
  // A 400 refuses the whole batch, this view's create with it.
  await context.route('**/api/v1/sync', (route) =>
    route.fulfill({ status: 400, body: 'refused for tests' }),
  );
  await dialog.getByTestId('view-save').click();
  await expect(refusal).toHaveAttribute('role', 'alert');
  await expect(refusal).toContainText('refused for tests');
  await expect(dialog.getByTestId('view-name')).toHaveValue('Refused');
  await expect(dialog.getByRole('radio', { name: 'Kanban' })).toBeChecked();
  await expect(nav.getByRole('link', { name: 'Refused' })).toHaveCount(0);

  // The same form, accepted: the alert and the dialog go.
  await context.unroute('**/api/v1/sync');
  await dialog.getByTestId('view-save').click();
  await expect(dialog).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Refused' })).toBeVisible();
});
