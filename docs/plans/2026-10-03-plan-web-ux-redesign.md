# План внедрения UX-редизайна Web

Дата: 2026-10-03. Статус: ready; реализация не начата.

Цель: перенести принятый UX в Nuxt-приложение, сохранив реальные операции core, URL-контекст, i18n, offline и синхронизацию. [Макеты и инструкция просмотра](../design/mockups/README.md) находятся в репозитории; Open Design не требуется для дальнейшей разработки. [Proposal](../proposals/2026-10-03-web-ux-redesign.md) задаёт продуктовые решения; [task spec контекста](../../specs/tasks/active/T-2026-10-03-web-redesign-context.md) — FR и критерии приёмки.

## Утверждённые правила и ограничения

- List/Kanban/Calendar — единая группа иконок справа вверху, доступная на desktop/mobile. Переключение временное и отражено в URL; сохранённый view меняется только явно.
- Все открытые, Сегодня, Предстоящие, проекты и saved views сохраняют смысл фильтров. Сегодня/Предстоящие используют scheduled OR due; текущая дата локальная и пересчитывается при смене суток. Создание в пресете не добавляет дату молча.
- Один уровень детей; раскрытие всех живых детей, метки вне фильтра, уникальный счётчик. Полный прогресс из core по соответствующему вхождению, независимое завершение родителя и детей.
- P0 — высший, P4 — низший приоритет; scheduled и due различаются; быстрый ввод использует существующую грамматику. Blur-save, отказы с сохранением ввода, повтор намерения без нового opId и Undo следуют core.
- Остальное оформление принято. Дополнительные UX-изменения обосновывать конкретными проблемами использования. Не добавлять новые сущности, remote assets или inline JS в production; CSP сохраняется.
- Vue/HTML — референсы. Не копировать fixture engine, boolean recurring-child completion, мгновенный settled-free Undo или фиктивные auth/sync в приложение.

Уточнение пользователя 2026-10-03: **P0 — самый высокий, P4 — самый низкий**; язык — один RU/EN switch с отображением текущей стороны. Это заменяет прежнюю шкалу, в которой P0 означал отсутствие приоритета. До переноса создать отдельную общую core/spec задачу: ascending sort, high-priority presets `[0,1]`, отображение P0, default быстрого ввода и стратегия совместимости существующих задач/сохранённых фильтров. Значения пользовательских данных не инвертировать молча. В макете новый ввод без pN использует P4; production default и миграция должны быть явно зафиксированы в общей задаче. Проверить одну шкалу Web/TUI/CLI. Перенести RU/EN switch из `mockups/references/LocaleSwitch.vue` с сохранением locale preference.

## Этапы

### 0. Подготовить реализацию и базовую проверку

- [ ] Сверить актуальные core topics/watch/projections и Web компоненты, исходные e2e и ограничения backend. Запустить baseline Web unit/typecheck/build и соответствующие e2e в изолированной тестовой среде по существующему setup.
- [ ] Перед каждой следующей группой создать отдельный task spec из `specs/tasks/templates/feature.md`: FR, затронутые файлы, failing-first проверки поведения и критерий завершения. Для только визуальных правок — браузерная проверка вместо тестов, повторяющих CSS.
- [ ] Выбрать один владелец каждой необходимой общей правки core; не менять чужие активные TUI файлы. Общие зависимости оформлять отдельно, без дублирования engine.

Результат: baseline записан, известны технические зависимости и границы первой задачи.

### 1. Тема, shell и единый переключатель режимов

Источники: `mockups/theme/`, `ux.css`, `references/ViewHeader.vue`, `references/ViewModeTabs.vue`. Целевые области: `apps/web/app/app.config.ts`, assets CSS, `AppShell.vue`, `ViewNav.vue`, `ViewBody.vue`, `useDb.ts`/watch и маршруты.

- [ ] Перенести семантические токены и focus/hover, не заменяя реальные sync/update/session компоненты демонстрационными.
- [ ] Реализовать transient layout из `?layout=list|kanban|calendar` и один header с roving focus, именами/подсказками EN/RU, active state и мобильными 44px целями. Отсутствующий override использует saved layout; invalid override игнорируется.
- [ ] Проверить загрузку календарной projection при transient calendar: простой смены шаблона недостаточно, если watch продолжает получать list items без placements/span. При необходимости расширить общий watch-контракт отдельной core задачей.
- [ ] Сохранить `task`, calendar `mode`/`at` и остальные query, reload, Back/Forward; смена view без override использует его default. Сохранённый layout меняется только явным save.

Результат: три режима работают на реальных задачах в одном фильтре; данные/saved view не меняются от переключения. Проверки: route/history/watch unit и `tabs.spec.ts`, `shell.spec.ts`, calendar smoke.

### 2. Навигация, пресеты и быстрое добавление

Источники: `ux.html/js`, `list.vue`. Области: `ViewNav`, `QuickAdd`, маршруты, core view/watch filter.

- [ ] Подключить Все открытые, Сегодня, Предстоящие и проекты через общую фильтрацию, без второй клиентской трактовки core.
- [ ] Уникальные счётчики включают свернутых детей; локальная дата обновляется на rollover и после возвращения вкладки. Не превращать All open во Inbox.
- [ ] Добавление с title-first и прогрессивным раскрытием полей; сохранить `#project @tag pN`, отказанный draft и accepted offline запись. Задача должна оставаться доступной, даже если создана вне текущего фильтра, без скрытого изменения её дат.

Результат: одинаковые presets/counts во всех режимах, быстрый ввод использует реальную write операцию. Проверки: list/e2e, dates/rollover, parsed input и отказ/offline.

### 3. Список, доска и иерархия

Источники: `list.vue`, `kanban.vue`; области: `TaskList/TaskRow`, `KanbanBoard/Column/Card`, `SubtaskList` и core details/topics. Реализовать FR-004–007 task spec контекста.

- [ ] Группировка по проектам и один уровень раскрытия; ребёнок без совпавшего родителя остаётся в своём проекте со ссылкой. Исключённые дети явно обозначены и не увеличивают счётчик.
- [ ] Брать progress из `Item.subtasks`, checklist из `taskDetails`; для дополнительных данных всех детей определить core projection/topic, поскольку checklist даёт только ID/title/closed.
- [ ] На доске ребёнок — отдельная карточка со своим статусом; parent progress единый с list/details. Сохранить manual order, DnD и keyboard Move to/up/down, управление колонками и подтверждение перераспределения.
- [ ] Завершение, Skip, Undo и reparent — только общие операции; recurring parent/child проверять по оси вхождения. Создание ребёнка подставляет проект, последующие изменения не каскадируют.

Результат: реальные hierarchy flows без двойного счёта и fixture completion. Проверки: core regression, list/kanban/editing e2e, мобильные затронутые контролы и keyboard alternatives.

### 4. Детали, повторение и удаление

Источники: drawer в `ux.html`, `task-dialogs.vue`, `references/DeleteTaskDialog.vue`. Области: `TaskDrawer`, `SubtaskList`, `RecurrenceDialog`, `DeleteTaskDialog`.

- [ ] Title/notes первыми, поля раскрываются постепенно; scheduled/due, blur-save и pending/refused feedback сохраняются.
- [ ] Parent/child навигация и закрытие сохраняют URL; возврат фокуса работает после rerender и исчезновения исходной карточки. Проверить вложенные dialogs, Tab/Shift+Tab/Escape нативно.
- [ ] Повторение и delete используют существующие settled/version правила; подзадача без независимого RRULE. Delete родителя каскадирует прямых детей по core и не обещает Undo.

Результат: редактор сохраняет намерение при отказе и остаётся доступным с клавиатуры. Проверки: editing e2e, recurrence/refusal, повтор submit без duplicate opId.

### 5. Календарь на реальных данных

Источники: `calendar.vue`, `references/CalendarDay.vue`, `PlacementChip.vue`, `MoveDateDialog.vue`; области: соответствующие production-компоненты и calendar utils.

- [ ] Перенести desktop grid/mobile список дней, полный date label, меню placement и доступный перенос без DnD.
- [ ] Проверить scheduled/due отдельно, closed/skipped placements, moved occurrence без due/RRULE, Undo до/после sync, отказ при children/version/original restrictions. Данные берутся из `calendarTasks` и реальных операций.
- [ ] Сохранить week/month `mode`/`at`, today navigation, span limits, local date rollover, drawer occurrence context и transient layout из этапа 1.

Результат: календарь работает с той же репликой и корректными отказами. Проверки: `calendar.spec.ts`, moved-copy core tests, responsive scroll и native меню/dialog.

### 6. Saved views, gate и состояния

Источники: `view-form.vue`, `gate.vue`, `references/`, `states.html`. Области: `ViewForm/FilterTree/FilterNode`, `AppGate/SignInForm/RegisterForm`, sync/update компоненты.

- [ ] Перенести формы, сохраняя raw JSON fallback, лимиты дерева, validation/refusal и явное сохранение layout/sort/filter.
- [ ] Перенести вход/регистрацию на реальные db.request/session/registrationOpen, а не переход в fixture.
- [ ] Проверить empty/loading/offline/queued/refused/recovery/update в тестовых fixtures приложения; галерею состояний не включать в рабочую навигацию.

Результат: реальная auth и sync видны в принятом оформлении. Проверки: views/register/screens/offline e2e и сохранение вводимых данных.

### 7. Итоговая приёмка и использование

- [ ] Web unit, typecheck, build, lint и полный Web e2e; source dependencies затронутого core — соответствующие tests/typecheck/build. `pnpm --filter @todoer/web e2e` использует тестовую БД по существующему setup, не пользовательские данные.
- [ ] Новые экраны EN/RU × light/dark: 360/390/430, tablet 768/820 и desktop 1366/1920; полная прокрутка, длинные названия, zoom, contrast, touch, native keyboard/focus, screen reader. CSP и offline production bundle проверяются после build.
- [ ] Общая реплика Web/TUI: parent/child → статус → progress → Undo → исключить родителя → offline → sync; дополнительно recurring occurrence и refused reparent. Не считать чтение TUI-spec подтверждением прогона.
- [ ] Обновить task specs и proposal фактическими результатами, закрыть завершённые задачи и записать changelog. Начать пользоваться приложением; дальнейшие UX-правки оформлять по конкретным наблюдениям.

Результат: готовый редизайн приложения, подтверждённый тестами и использованием. Текущее состояние — подготовленные источники и план; ни один этап реализации ещё не отмечен выполненным.

## Порядок и зависимость работ

0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Каждый этап — отдельная reviewable группа изменений; при обнаружении общей зависимости core сначала отдельная задача core, затем потребитель Web. Не переносить весь bundle в `apps/web` одним копированием. Старые W2–W5 планы описывают исходную реализацию; этот план задаёт расширенный UX и осознанное обновление тестовых контрактов.
