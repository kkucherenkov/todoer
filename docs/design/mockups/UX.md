# Todoer — connected UX proposal

**Start at [ux.html](ux.html).** One interface shares tasks across list, board and calendar. [kanban.html](kanban.html) pairs light/dark reference states; [kanban.vue](kanban.vue) preserves the source board contract. [index.html](index.html) links everything and retains the original token/list references. The repository is unchanged.

## UX decisions

- **Capture in context:** title first, Add task or Enter, optional fields revealed in place. Errors retain input. [Todoist Quick Add](https://www.todoist.com/help/todoist/features/use-task-quick-add-in-todoist-va4Lhpzz) informs this progressive capture, not its parser or priority scale. Todoer keeps standalone `#project @tag p0–p4`, including Cyrillic; P0 is highest; P4 is lowest. “tomorrow” remains literal title text.
- **Two distinct dates:** When maps to `scheduledOn`, the day to work on it; Deadline maps to `dueOn`, the day it must be finished. This borrows [Things’ distinction](https://culturedcode.com/things/support/articles/2803579/), without times or reminders.
- **Reusable contexts:** daily presets, project shortcuts and saved views use Todoer’s existing filters, inspired by [OmniFocus perspectives](https://support.omnigroup.com/documentation/omnifocus/universal/4.3.3/en/perspectives/). Changing views never assigns task data.
- **Comfortable scanning:** titles wrap, metadata stays quiet, density follows content. Actions appear on hover and keyboard focus; touch actions remain visible. Zinc, indigo and system fonts remain bound to unchanged tokens.
- **Contextual editing:** one drawer for list and board. Title/notes lead; dates are always visible; advanced fields expand. Quiet local-save feedback explains blur-save. Refusal restores the saved value while retaining the rejected draft with Retry change.

## Finalized project → task → subtask outline

- **Project groups:** List groups top-level matching tasks by their existing project, with a clearly named No project group for unassigned roots. A matching child nests under its matching parent, even when the child belongs to a different project; its own project remains visible in metadata. If its parent is excluded or closed, it becomes a standalone row grouped by its own project, with an explicit Open parent link. This is presentation of existing project membership and one-level parent linkage, not new entity types.
- **One unified disclosure:** parents start unfolded; fold state is transient and retained across layouts/filters. Matching children appear once as ordinary indented task rows. The same disclosure adds compact contextual links for excluded/completed children, explicitly labelled Outside this filter or Done. There is no second matching-child checklist in the list. Creation unfolds the parent immediately. Full completed/total child progress and the number of matching/folded children have separate labels. Header/sidebar and project-section counts include unique matching task IDs, including folded rows, and exclude contextual links. Cross-project nested children count once in the section where they are rendered; the project filter itself still evaluates each task’s own project.
- **Independent board:** children remain individual cards in their own status columns with parent links. Parent progress uses every live direct child. Folding, opening details or moving a card never moves its relatives. The accepted top-right localized List/Kanban/Calendar controls and shared drawer remain intact; switching changes only local presentation and preserves filters/tasks/folds.
- **Creation and editing:** the drawer pre-fills the new child’s project from the parent at submission; explicit `#project` syntax overrides the default, as in core `add`. Tags and p0–p4 use the same capture parser. Later edits of either project affect only that task. A child cannot create children or set an independent recurrence rule; its repeat control is disabled with an explanation. No same-project restriction or automatic date assignment is introduced. Refused creation retains the input.
- **Core alignment:** read `operations.ts` add/mark/taskDetails and the current TUI spec. Completing a one-off parent leaves children open; completing all children leaves the parent open (ADR 0009). Each task owns its status. The proposal changes outline presentation, not mark/Undo or project-edit semantics. Manual list reorder operates among visible outline siblings in the same root project; it never reparents. Board moves retain the accepted source-compatible behavior.
- **Integration:** derive nesting from filtered `Item[]`, full progress from an unfiltered projection/details topic, and contextual child discovery from parent details. Do not calculate totals from filtered children. The board Vue reference already accepts unfiltered `parentDetails` and preserves parent-occurrence-aware mark writes. Core reads a recurring parent’s checklist at the parent’s current occurrence, while a child’s standalone view can expose its own occurrence. The fixture prototype still simplifies recurring-child marks to a boolean; this differs from core and does not validate that occurrence-axis case. Production must retain core projections/mark operations, not copy this fixture shortcut. No core/TUI or backend changes were made.

## Exact navigation and counts

Fixture today is **2026-10-03**, shown in the review strip. Production uses the client’s local date and re-evaluates at day rollover. Counts are unique open task IDs, including one-level subtasks, evaluated by the same projection as the view.

| Context | Existing filter | Semantics |
| --- | --- | --- |
| All open | `{ "and": [] }` | Every open task, assigned or unassigned. Never renamed Inbox. |
| Today | `{ "or": [{ "scheduled": { "to": 0 } }, { "due": { "to": 0 } }] }` | Scheduled **or** due on/before today, deduplicated. Matches the repository’s Today template; overdue deadlines remain explicit in task metadata. |
| Upcoming | `{ "or": [{ "scheduled": { "from": 1 } }, { "due": { "from": 1 } }] }` | Either date after today, no upper bound. Project outline; future dates remain visible in metadata. Membership can overlap Today when dates straddle today. |
| Project | `{ "project": "<UUID>" }` | Tasks in the existing project. Personal intentionally starts empty. Fixture names resolve to project IDs in production. |
| High priority | `{ "priority": [0, 1] }` | P0 before P1 within each project/outline sibling branch; within-context reorder disabled. |
| Work board | `{ "project": "<Work UUID>" }` | Manual saved view that opens Board. Same task collection. |

Capture does not silently inherit Today/Upcoming dates. Unmatched tasks get “Added to All open” feedback. Column capture explicitly names its target; project/date fields remain editable.

List shows open tasks. Board uses the **same filter plus one-off tasks closed within 7 days**, matching `boardTasks(..., closedDays = 7)`. Sidebar counts stay open counts; the board header separates open/completed; columns count displayed cards. Recurring completion advances to the next occurrence in the first open column, not a closed card.

Manual reorder works in All open/project lists and manual boards. Today/Upcoming retain their prior reorder-disabled behavior even with project grouping. High priority disables within-column reorder but permits cross-column moves. Calendar is a third layout of the same context: switching keeps the filter, selected `?task=` and both date fields; `?mode=week|month&at=` only adds the visible range.

## Connected screens

[calendar.html](calendar.html), [view-form.html](view-form.html) and [task-dialogs.html](task-dialogs.html) open the same working interface and fixtures as `ux.html` at a given entry point. Each page ends with paired Light/Dark and English/Русский state references. [gate.html](gate.html) links to the shared UX after a fixture-only accepted sign-in/registration. [states.html](states.html) reviews sync and empty/loading states with isolated fixture storage. Vue references sit beside each page.

- **Calendar:** week and month grids (a dated day list in narrow containers) with Today, previous/next and a marked current date. When and Deadline appear as separate placements; a recurring task places each occurrence in range. Moving a one-off placement rewrites only that field. Moving an occurrence creates a moved copy and leaves the series intact. Every accepted move has fixture Undo, and refusal keeps the move dialog open with the error. Closed placements stay visible but cannot be moved. Month cells overflow into “+N more”, which opens that week.
- **Saved views:** New view in navigation; Edit and Delete on the active saved view. A preset seeds the filter tree, the tree edits as structured rows, and filters it cannot represent open as raw JSON. Invalid drafts stay in the form with the problem shown inline. Layout (list, kanban, calendar) and sort belong to the view; a manual layout switch is transient.
- **Repeat:** none, daily, weekly, monthly, yearly or a custom RRULE, with the next dates as a live preview and validation through the local rule parser. Subtasks and moved copies cannot open it. Ended series and moved occurrences show their own state and a way back to the series.
- **Delete task:** names the task and how many subtasks go with it, states that it cannot be undone, and offers no Undo toast. Cancel returns focus to the origin.
- **Access gate:** sign-in and first-owner registration, plus loading, insecure origin, local engine failure, submitting, wrong credentials, password mismatch and refused registration. Fields hold read-only dummy credentials; nothing is sent or stored. Accepted fixture sign-in/registration links to ux.html; it is not an authenticated session.

## Capability boundary

**Existing:** single owner, projects/tags/p0–p4, scheduled/due dates, recurrence, one-level subtasks (W5), saved filters, list/board/calendar, URL drawer, blur-save, local outbox, sync/refusal/update states, manual moves, completing-column Done/Undo, and Columns management.

**Proposed client changes:** pinned daily/project navigation, per-context layout switching, project/task/subtask outline and contextual filtered-child discovery, grouping/density, structured capture and column capture, When/Deadline labels, saved feedback/recoverable rejected drafts, and ordinary-move Undo. No teams, AI, reminders, time scheduling or new backend entities.

**Review-only:** frozen clock, theme controls, failure injection and reset. Locale switching exists; its review-strip placement is not a settings proposal. Fixtures persist in localStorage; no server is contacted. Reload retains tasks; Reset replaces them. Rule validation and expansion use local read-only core/web snapshots, including custom RRULE, ended-series and moved-copy references. Calendar records done/skipped dates for the repeating task. Recurring children remain a boolean fixture simplification; settled versions, replay-safe op IDs, server batches and actual outbox recovery are not simulated.

## Implementation implications

1. Port into existing Nuxt UI components/composables; retain DB topics, i18n, selectors and route-change blur flush. Presets can be saved filter records. Navigation derivation/layout preference need client decisions; counts must use the existing evaluator. Add both locale strings; visible When/Deadline labels require deliberate accessible-name/test migration.
2. Structured capture currently composes `add`, then `edit` for dates and `move` for a column. Preserve minted retry IDs and handle partial success without duplicates. Atomic composition needs a core-operation spec; the prototype does not prove atomicity.
3. Keep `Item.column`/displayStatus, `move` view/statusId/after and returned notes. `kanban.vue` uses `useMarked` for completing Undo and existing `ColumnsDialog` for global live-task counts, rollback, duplicate names, completing/last-open constraints and redistribution to the first other column. It intentionally does not wire proposed capture or ordinary-move Undo into production writes.
4. Ordinary-move Undo must mint an inverse placement/rank operation, rechecked against later changes/refusals. The fixture restores only prior mark/placement fields, preserving later title/project edits, but does not model concurrent server ranks. Drawer recovery needs per-field draft generations and retained refused intent; production recurrence continues using client-core.
5. Column deletion counts **all live tasks on the status**, beyond the filtered board. Completing and last-open columns cannot be deleted. User-renamed column names remain unchanged across locale switches. No new UI dependencies are required.

## Verification and limits

Scoped hierarchy verification: project groups including No project; matching child nested once and separate board card; fold/unfold without count changes; Today/Upcoming/project cases excluding either parent or child; cross-project children; creation default and non-cascading project edits; complete/progress/Undo; independent parent completion; disabled child recurrence; retained creation input on refusal; keyboard disclosure and top-right layout switching. Checks run against the actual external script in the existing DOM harness, in both themes and English/Russian. New indentation and controls were checked against accepted mobile widths/targets; the prior manual acceptance of mobile list, board and drawer remains the baseline.

Earlier prototype DOM checks against the actual external script: shared add/edit/list/board state, non-mutating filters/counts, dates/project blur-save, Done/recurring/Skipped Undo, menu arrows/Escape, move/Undo, drag event paths, column add/rename/reorder/completing/delete, retained failed input/date retry, offline queue, refusal/first-sync recovery, subtasks, theme/locale, mobile navigation Tab/Escape and honest Calendar labeling (since replaced by the working calendar).

Inspected a browser-rendered desktop preview; reviewed CSS constraints at 360/390/430/600/768/820/1024/1366/1440/1920px, scoped board scrolling, mobile targets and reduced motion. Tokens match the source byte for byte; local links/assets and reference syntax checks pass.

Текущая проверка продолжения: [QA.md](QA.md), воспроизводимые команды и [qa/results.txt](qa/results.txt). Утверждения предыдущей итерации выше сохранены как исторический отчёт, а не как повторно выполненная проверка.

**Verification limits:** DOM tests do not prove native dialog trapping or touch geometry. Mobile list, board and details were manually accepted by the user; this iteration checks only the new outline controls and does not repeat broad mobile acceptance. The current Vue set passed script/template compilation and an isolated vue-tsc check using real source types. No application build or repository tests were run.

## Продолжение 2026-10-03: готовность и перенос

- Календарь: scheduled и due остаются разными placements, due у серии не имеет occurrence. Перенос серии создаёт разовую копию **без due**, оставляет правило и старт серии, исключает только исходное вхождение. Done отображается закрытым, skipped не отображается; Undo возвращает соответствующую дату. Это fixture-поведение, а не вызов core `moveOccurrence`/`undoMove`.
- Предпочтения представления: сортировка применяется к списку и доске, включая соответствующих детей внутри сохранённой иерархии; немануальная сортировка отключает reorder. Календарь сохраняет порядок задач при совпадении дня. Смена режима вручную не переписывает сохранённое представление. Неизвестный ID фильтра остаётся видимым; не подменяется первым значением select.
- Вход и регистрация: тестовые поля не принимают реальные пароли и не сохраняются. EN/RU, light/dark, mismatch, refused и переход после локального accepted доступны. Vue-формы сохраняют реальный `db.request`, submit-only confirmation и серверное правило пароля; HTML не проверяет сеть или сессию.
- Удаление: initial focus на Cancel соответствует текущему источнику, несмотря на устаревший текст DESIGN.md. Отказ оставляет подтверждение открытым; удаление родителя удаляет прямых детей. Для этого действия Undo отсутствует. В core каждый удаляемый объект должен быть settled; fixture эту гарантию не обеспечивает.
- Состояния: states.html имеет отдельный ключ localStorage. Offline, queued, refused, recovery, пустая доска/колонка/календарь, первая синхронизация и loading не добавлены в основной рабочий экран. Gallery-фрагменты inert и не создают ложных tab-stop. Recovery — явно обозначенная локальная симуляция.
- Vue: четыре основных референса и десять supporting SFC перечислены в references/README.md. Нативные Nuxt UI компоненты и существующие composables/worker остаются зависимостями приложения; этот набор нельзя считать автономным приложением.

Перед переносом нужны task specs для URL/i18n/CSP, временного переключения layout, исходника всех детей и полного прогресса, occurrence-aware mark/skip/Undo и проверки settled/version. Чужие worktree, TUI и приложение не изменялись.

## Точечная правка: единый переключатель трёх режимов

List / Kanban / Calendar — один tablist справа вверху верхней панели страницы. У Calendar тот же icon-button, 44×44 target, нейтральный active background с indigo-индикатором, tooltip/title и aria-label, что у двух других режимов. RU: «Список / Доска / Календарь». Отдельный Calendar под заголовком удалён во всех рабочих HTML-входах; в sidebar нет отдельного входа режима. Проекты и сохранённые представления остаются контекстами фильтра, а не вторыми переключателями.

Roving tabindex: только активный режим входит в Tab sequence. ArrowRight/ArrowLeft переключают три режима по кругу; Home → List, End → Calendar. Click и переключение стрелками сохраняют фокус на выбранной кнопке после render. Enter/Space используют стандартное поведение native button. Общий tabpanel связан с активной кнопкой через aria-labelledby.

Режим меняет локальную презентацию и `?layout=list|board|calendar`, сохраняя filter/view, задачи, `?task=`, календарные `?mode=&at=` и saved view.layout. board остаётся существующим URL-значением канбана; название EN-кнопки — Kanban. calendar.html уважает явно заданный layout при перезагрузке. Drawer остаётся модальным: header под открытым drawer не становится интерактивным; сохранение drawer проверено программным изменением режима и URL reload.

На 390px три кнопки остаются справа в верхнем ряду, заголовок занимает среднюю колонку, счётчик переносится ниже. Тела списка/доски/календаря и иерархия не изменены. Vue-референс общего shell — references/ViewHeader.vue + ViewModeTabs.vue; существующие List/Kanban/Calendar SFC остаются телами и не дублируют header.

Актуальный скриншот всех active states в EN/RU × light/dark × desktop/mobile: [qa/header-review.png](qa/header-review.png). Только затронутые проверки текущей правки — в дополнении QA.md; прежние широкие проверки не запускались повторно.
