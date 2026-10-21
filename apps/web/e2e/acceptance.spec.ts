import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import {
  arrowTo,
  day,
  expect,
  projectId,
  seedTask,
  seedView,
  test,
} from './fixtures';

// Stage 7, reduced (plan "Decisions and tracks" item 3): the redesigned
// screens at 390 and 1366, EN/RU × light/dark, on one engine. The whole
// suite is not multiplied by the matrix.
test.skip(({ browserName }) => browserName !== 'chromium', 'chromium only');

const EN_LONG =
  'Prepare the quarterly report for the board with every appendix, the reviewed budget and the notes from the planning session';
const RU_LONG =
  'Подготовить квартальный отчёт для совета директоров со всеми приложениями, проверенным бюджетом и заметками с планёрки';
const VIEW_LONG =
  'Everything that has to happen before the release candidate is cut, including the documentation and the migration notes';

/** Nuxt UI's own label for the navbar toggle, per locale. */
const OPEN_SIDEBAR = /^(Open sidebar|Открыть боковую панель)$/;

/** Rules switched off, each with its reason. None: every screen passes
 *  all of axe's rules at `serious` and `critical`. */
const DISABLED: string[] = [];

async function axe(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page })
    .disableRules(DISABLED)
    .analyze();
  const bad = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
    }));
  expect(bad, `axe on ${screen}`).toEqual([]);
}

/** No sideways page scroll; the last item can be scrolled into view; each
 *  long text is whole in its box and inside the viewport. */
async function fits(
  page: Page,
  screen: string,
  last: Locator,
  long: Locator[] = [],
) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    `${screen}: no horizontal page scroll`,
  ).toBe(true);
  await last.scrollIntoViewIfNeeded();
  // 0.95, not 1: a scrolled modal can leave its last button a fraction of
  // a pixel under the edge (0.99 measured), which no one can see.
  await expect(last, `${screen}: scrolls to its end`).toBeInViewport({
    ratio: 0.95,
  });
  for (const text of long) {
    await text.scrollIntoViewIfNeeded();
    const box = await text.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        whole:
          el.scrollWidth <= el.clientWidth + 1 &&
          el.scrollHeight <= el.clientHeight + 1,
        inside: r.left >= 0 && r.right <= window.innerWidth + 0.5,
      };
    });
    expect(box, `${screen}: ${await text.innerText()}`).toEqual({
      whole: true,
      inside: true,
    });
  }
}

const widths = [390, 1366] as const;
const locales = ['en', 'ru'] as const;
const themes = ['light', 'dark'] as const;

for (const width of widths)
  for (const locale of locales)
    for (const theme of themes) {
      const name = `${width} ${locale} ${theme}`;

      async function setUp(page: Page) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.context().addCookies([
          {
            name: 'todoer_locale',
            value: locale,
            domain: 'localhost',
            path: '/',
          },
        ]);
      }

      async function themed(page: Page) {
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        if (theme === 'dark')
          await expect(page.locator('html')).toHaveClass(/dark/);
        else await expect(page.locator('html')).not.toHaveClass(/dark/);
      }

      test(`acceptance: gate ${name}`, async ({ page }) => {
        await setUp(page);
        // The built SPA, served by the backend under its CSP; the guard
        // fixture fails the test on any violation.
        const response = await page.goto('/');
        expect(response?.headers()['content-security-policy']).toContain(
          'script-src',
        );
        await expect(page.getByTestId('sign-in')).toBeVisible();
        await themed(page);
        await fits(page, 'gate', page.getByTestId('sign-in'));
        await axe(page, 'gate');
      });

      test(`acceptance: screens ${name}`, async ({ page, account, cli }) => {
        test.slow();
        const { token } = account;
        await cli(token, 'add', 'Kick-off #work');
        const work = await projectId(page.request, token, 'work');
        const en = await seedTask(page.request, token, {
          title: EN_LONG,
          projectId: work,
          scheduledOn: day(),
          priority: 0,
        });
        const parent = await seedTask(page.request, token, {
          title: RU_LONG,
          dueOn: day(),
        });
        await seedTask(page.request, token, {
          title: 'Child of the long one',
          parentId: parent,
          rank: 'a1',
        });
        for (let i = 0; i < 14; i++) {
          await seedTask(page.request, token, {
            title: `Filler ${String(i).padStart(2, '0')}`,
            rank: `b${String(i).padStart(2, '0')}`,
          });
        }
        await seedView(page.request, token, VIEW_LONG, 'a0', 'list');
        await setUp(page);

        // The child links its parent by title: its row or card is not the
        // parent's.
        const longTitles = (scope: Locator, testId: string) =>
          [EN_LONG, RU_LONG].map((text) =>
            scope
              .getByTestId(testId)
              .filter({ hasText: text })
              .filter({ hasNot: page.getByTestId('parent-link') }),
          );

        // Shell and navigation; at 390 the sidebar is a slideover.
        await page.goto('/');
        await expect(page.getByTestId('task-row')).toHaveCount(18);
        await themed(page);
        if (width < 1024) {
          await page.getByRole('button', { name: OPEN_SIDEBAR }).click();
        }
        const nav = page.getByTestId('nav').filter({ visible: true });
        await expect(nav).toBeVisible();
        await fits(
          page,
          'navigation',
          page.getByTestId('new-view').filter({ visible: true }),
          [nav.getByText(VIEW_LONG)],
        );
        await axe(page, 'navigation');
        if (width < 1024) await page.keyboard.press('Escape');

        // List.
        const list = page.getByTestId('task-list');
        await fits(
          page,
          'list',
          page.getByTestId('task-row').last(),
          longTitles(list, 'task-title'),
        );
        await axe(page, 'list');

        // Board.
        await page.goto('/?layout=kanban');
        await expect(page.getByTestId('card')).toHaveCount(18);
        await fits(
          page,
          'board',
          page.getByTestId('card').last(),
          longTitles(page.getByTestId('board'), 'card'),
        );
        await axe(page, 'board');

        // Calendar.
        await page.goto('/?layout=calendar');
        const today = page.locator(
          `[data-testid="calendar-day"][data-date="${day()}"]`,
        );
        await expect(today.getByTestId('placement')).toHaveCount(2);
        await fits(
          page,
          'calendar',
          page.getByTestId('calendar-day').last(),
          longTitles(today, 'placement-title'),
        );
        await axe(page, 'calendar');

        // Drawer, with the details open.
        await page.goto(`/?task=${en}`);
        const drawer = page.getByRole('dialog');
        await expect(drawer.getByRole('textbox').first()).toHaveValue(EN_LONG);
        await drawer.locator('details summary').click();
        await fits(page, 'drawer', page.getByTestId('delete-task'));
        await axe(page, 'drawer');
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);

        // View form.
        if (width < 1024) {
          await page.getByRole('button', { name: OPEN_SIDEBAR }).click();
        }
        await page.getByTestId('new-view').filter({ visible: true }).click();
        const form = page.getByRole('dialog');
        await expect(form.getByTestId('view-name')).toBeVisible();
        await fits(page, 'view form', form.getByTestId('view-save'));
        await axe(page, 'view form');
      });
    }

/** Tab (or Shift+Tab) until `target` has the focus, then check the ring
 *  is drawn: reachable by the keyboard alone, and visibly so. */
async function tabTo(page: Page, target: Locator, back = false) {
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((e) => e === document.activeElement)) break;
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  }
  await expect(target).toBeFocused();
  await expect.poll(() => ringOf(target), String(target)).toBe(true);
}

/** `:focus-visible` matches and an outline or a ring is painted. */
const ringOf = (target: Locator) =>
  target.evaluate((e) => {
    if (!e.matches(':focus-visible')) return false;
    const s = getComputedStyle(e);
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    return outline || s.boxShadow !== 'none';
  });

test('acceptance: every keyboard path, with visible focus and focus return', async ({
  page,
  account,
  cli,
}) => {
  test.slow();
  const { token } = account;
  const open = async () =>
    (
      JSON.parse(await cli(token, 'list', '--json')) as {
        data: { title: string }[];
      }
    ).data.map((t) => t.title);
  await cli(token, 'add', 'Second');
  await seedTask(page.request, token, {
    title: 'Dated',
    scheduledOn: day(),
    rank: 'a5',
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('task-row')).toHaveCount(2);

  // A mouse click focuses without a ring.
  const modes = page.getByRole('tablist', { name: 'Layout' });
  await modes.getByRole('tab', { name: 'List' }).click();
  expect(await ringOf(modes.getByRole('tab', { name: 'List' }))).toBe(false);

  // Quick add: type, Enter adds.
  const quick = page.getByRole('textbox', { name: 'Quick add' });
  await tabTo(page, quick);
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('task-row')).toHaveCount(3);

  // Task row: the check button, the actions menu, the title.
  const row = page.getByTestId('task-row').filter({ hasText: 'Second' });
  await tabTo(page, row.getByRole('button', { name: 'Mark done' }));
  await page.keyboard.press('Enter');
  await expect.poll(open).not.toContain('Second');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(open).toContain('Second');

  const actions = row.getByRole('button', { name: 'Task actions' });
  await tabTo(page, actions);
  await page.keyboard.press('Enter');
  for (const item of ['Skip', 'Move up', 'Move down', 'Open']) {
    await expect(
      page.getByRole('menuitem', { name: item, exact: true }),
    ).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();

  const title = row.getByTestId('task-title');
  await tabTo(page, title, true);
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Second',
  );

  // Drawer: fields commit on blur; the subtask input adds on Enter.
  const field = drawer.getByRole('textbox', { name: 'Title' });
  await tabTo(page, field);
  await page.keyboard.press('End');
  await page.keyboard.type(' task');
  await page.keyboard.press('Tab');
  await expect.poll(open).toContain('Second task');
  const sub = drawer.getByRole('textbox', { name: 'Add subtask' });
  await tabTo(page, sub);
  await page.keyboard.type('Sub one');
  await page.keyboard.press('Enter');
  await expect(
    drawer.getByRole('checkbox', { name: 'Done: Sub one' }),
  ).toBeVisible();

  // Delete over the drawer: Cancel has the focus; Escape closes only it.
  const del = page.getByTestId('delete-task');
  await tabTo(page, del);
  await page.keyboard.press('Enter');
  await expect(page.locator('[role="dialog"]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toHaveCount(1);
  await expect(del).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(title).toBeFocused();

  // Kanban card: focusable, Enter opens; the menu has Move to, Move up,
  // Move down and Open.
  await tabTo(page, modes.getByRole('tab', { name: 'List' }), true);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('board')).toBeVisible();
  const card = page.getByTestId('card').filter({ hasText: 'First' });
  await tabTo(page, card);
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  const cardActions = card.getByRole('button', { name: 'Task actions' });
  await tabTo(page, cardActions);
  await page.keyboard.press('Enter');
  for (const item of ['Move up', 'Move down', 'Open']) {
    await expect(
      page.getByRole('menuitem', { name: item, exact: true }),
    ).toBeVisible();
  }
  await arrowTo(page, page.getByRole('menuitem', { name: 'Move to' }));
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Doing' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(cardActions).toBeFocused();

  // Columns dialog: rename in place, Move up / Move down, Make completing,
  // Delete with an inline confirm.
  const columnsButton = page.getByRole('button', { name: 'Columns' });
  await tabTo(page, columnsButton, true);
  await page.keyboard.press('Enter');
  const columns = page.getByRole('dialog');
  const doing = columns.getByRole('listitem', { name: 'Doing', exact: true });
  const rename = doing.getByRole('textbox', { name: 'Column name' });
  await tabTo(page, rename);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Busy');
  await page.keyboard.press('Enter');
  const busy = columns.getByRole('listitem', { name: 'Busy', exact: true });
  await expect(busy).toBeVisible();
  await tabTo(page, busy.getByRole('button', { name: 'Move up' }));
  await page.keyboard.press('Enter');
  await expect(columns.getByRole('listitem').first()).toHaveAttribute(
    'aria-label',
    'Busy',
  );
  await tabTo(page, busy.getByRole('button', { name: 'Move down' }));
  await page.keyboard.press('Enter');
  await expect(columns.getByRole('listitem').nth(1)).toHaveAttribute(
    'aria-label',
    'Busy',
  );
  await tabTo(page, busy.getByRole('button', { name: 'Make completing' }));
  await expect(
    busy.getByRole('button', { name: 'Make completing' }),
  ).toBeEnabled();
  await tabTo(page, busy.getByRole('button', { name: 'Delete', exact: true }));
  await page.keyboard.press('Enter');
  const confirm = busy.getByRole('button', { name: 'Delete column' });
  await tabTo(page, confirm);
  await page.keyboard.press('Enter');
  await expect(busy).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(columns).toHaveCount(0);
  await expect(columnsButton).toBeFocused();

  // Calendar: Previous, Next, Today, Week / Month; a chip opens on Enter;
  // its menu has Open and Move to date…, which asks for a date.
  await tabTo(page, modes.getByRole('tab', { name: 'Kanban' }), true);
  await page.keyboard.press('ArrowRight');
  const heading = page.getByTestId('calendar-title');
  await expect(heading).toBeVisible();
  const week = await heading.innerText();
  await tabTo(page, page.getByRole('button', { name: 'Previous' }));
  await page.keyboard.press('Enter');
  await expect(heading).not.toHaveText(week);
  await tabTo(page, page.getByRole('button', { name: 'Next' }));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Today' }));
  await page.keyboard.press('Enter');
  await expect(heading).toHaveText(week);
  await tabTo(page, page.getByRole('tab', { name: 'Week' }));
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Month' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Week' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const chip = page.getByTestId('placement').filter({ hasText: 'Dated' });
  await tabTo(page, chip);
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chip).toBeFocused();
  const chipActions = chip.getByRole('button', { name: 'Placement actions' });
  await tabTo(page, chipActions);
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('menuitem', { name: 'Open', exact: true }),
  ).toBeVisible();
  await arrowTo(page, page.getByRole('menuitem', { name: 'Move to date…' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByLabel('Date', { exact: true }));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(chipActions).toBeFocused();

  // Filter tree: every node's controls are form controls in the tab order.
  const newView = page.getByTestId('new-view');
  await tabTo(page, newView, true);
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog');
  await expect(form.getByTestId('view-name')).toBeVisible();
  for (const control of [
    form.locator('[data-testid^="op-"]').first(),
    form.locator('[data-testid^="add-"]').first(),
    form.locator('[data-testid^="not-"]').last(),
    form.locator('[data-testid^="remove-"]').first(),
  ]) {
    await tabTo(page, control);
  }
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(newView).toBeFocused();
});
