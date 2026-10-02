import { count, expect, test } from './fixtures';

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
  await dialog.getByRole('radio', { name: 'Project…' }).click();
  await pick('view-picker', 'home');
  await pick('view-sort', 'Due date');
  await dialog.getByTestId('view-save').click();
  await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible();
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

  // Delete: confirmed, gone from the sidebar and from the CLI.
  await page.getByTestId('delete-view').click();
  await page.getByTestId('confirm-delete').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(nav.getByRole('link', { name: 'Home' })).toHaveCount(0);
  await expect.poll(async () => (await viewNames()).length).toBe(0);
});
