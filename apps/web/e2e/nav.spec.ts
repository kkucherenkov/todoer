import type { Page } from '@playwright/test';
import {
  count,
  day,
  expect,
  projectId,
  seedTask,
  seedView,
  test,
} from './fixtures';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Views' });
/** A destination's link; its text is the label, then the core's count. */
const entry = (page: Page, label: string) =>
  nav(page).getByRole('link', { name: new RegExp(`^${label}\\b`) });
const titles = (page: Page) => page.getByTestId('task-title');

test('navigation: built-in destinations and projects with core counts', async ({
  page,
  account,
  cli,
}) => {
  const parent = await seedTask(page.request, account.token, {
    title: 'Pay rent',
    dueOn: day(0),
  });
  await seedTask(page.request, account.token, {
    title: 'Find receipt',
    parentId: parent,
    scheduledOn: day(0),
    dueOn: day(0),
  });
  await seedTask(page.request, account.token, {
    title: 'Book dentist',
    scheduledOn: day(2),
  });
  await cli(account.token, 'add', 'Sweep #home');
  const home = await projectId(page.request, account.token, 'home');
  await seedView(page.request, account.token, 'Saved one', 'a0', 'list');

  await page.goto('/');
  await expect(count(page)).toBeVisible();
  await expect(nav(page).getByRole('link')).toHaveText([
    /^All open\s*4$/,
    /^Today\s*2$/,
    /^Upcoming\s*1$/,
    /^home\s*1$/,
    'Saved one',
  ]);
  await expect(entry(page, 'All open')).toHaveAttribute('aria-current', 'page');

  // Keyboard: a destination opens from its focused link.
  await entry(page, 'Today').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByTestId('view-title')).toHaveText('Today');
  await expect(entry(page, 'Today')).toHaveAttribute('aria-current', 'page');
  await expect(entry(page, 'All open')).not.toHaveAttribute('aria-current');
  // Order is the core's sort, W3's to present: only membership is checked.
  await expect
    .poll(async () => (await titles(page).allTextContents()).sort())
    .toEqual(['Find receipt', 'Pay rent']);

  await entry(page, 'Upcoming').click();
  await expect(page).toHaveURL(/\/upcoming$/);
  await expect(titles(page)).toHaveText(['Book dentist']);

  await entry(page, 'home').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${home}$`));
  await expect(page.getByTestId('view-title')).toHaveText('home');
  await expect(titles(page)).toHaveText(['Sweep']);
  await page.reload();
  await expect(titles(page)).toHaveText(['Sweep']);
  await expect(entry(page, 'home')).toHaveAttribute('aria-current', 'page');

  // An unknown project is the core's `deleted` problem, not an empty list.
  await page.goto(`/projects/${crypto.randomUUID()}`);
  await expect(page.getByText('This view no longer exists.')).toBeVisible();

  // RU labels.
  await page.getByRole('switch', { name: 'Interface language' }).click();
  const ru = page.getByRole('navigation', { name: 'Представления' });
  await expect(ru.getByRole('link').first()).toHaveText(/^Все открытые\s*4$/);
  await expect(ru.getByRole('link', { name: /^Сегодня/ })).toHaveText(
    /^Сегодня\s*2$/,
  );
  await expect(ru.getByRole('link', { name: /^Предстоящие/ })).toBeVisible();
  await expect(ru.getByText('Проекты')).toBeVisible();
});

test('navigation: a write changes the counts without a reload', async ({
  page,
  account,
}) => {
  await seedTask(page.request, account.token, {
    title: 'Pay rent',
    dueOn: day(0),
  });
  await page.goto('/today');
  await expect(titles(page)).toHaveText(['Pay rent']);
  await expect(entry(page, 'Today')).toHaveText(/^Today\s*1$/);
  await expect(entry(page, 'All open')).toHaveText(/^All open\s*1$/);

  await page.getByRole('button', { name: 'Add details' }).click();
  await page.getByRole('textbox', { name: 'Quick add' }).fill('Call bank');
  await page.getByLabel('Due').fill(day(0));
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(entry(page, 'Today')).toHaveText(/^Today\s*2$/);
  await expect(entry(page, 'All open')).toHaveText(/^All open\s*2$/);
  await expect(titles(page)).toHaveCount(2);

  // A task with no date goes to All open only: no date is added for Today.
  // The add has settled once the draft clears.
  const input = page.getByRole('textbox', { name: 'Quick add' });
  await expect(input).toHaveValue('');
  await input.fill('No date');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(
    page.getByText('Added to All open', { exact: true }),
  ).toBeVisible();
  await expect(entry(page, 'All open')).toHaveText(/^All open\s*3$/);
  await expect(entry(page, 'Today')).toHaveText(/^Today\s*2$/);
});

test('navigation: reachable on a phone', async ({ page, account }) => {
  await seedTask(page.request, account.token, {
    title: 'Later',
    dueOn: day(3),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('view-title')).toHaveText('All open');
  await expect(entry(page, 'Upcoming')).toBeHidden();
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await entry(page, 'Upcoming').click();
  await expect(page).toHaveURL(/\/upcoming$/);
  await expect(page.getByTestId('view-title')).toHaveText('Upcoming');
});
