# QA — продолжение редизайна todoer

Дата: 2026-10-03. Объект проверки: только проект Open Design `todoer-redesign-8bd9`. Приложение, core, TUI и чужие worktree не изменены. Иерархия сохранена; проверена только регрессия затронутых путей.

## Результаты

| Проверка | Фактический результат | Доказательство |
|---|---|---|
| SFC parse + script/template compile | 14 Vue-файлов, без ошибок | [results.txt](qa/results.txt) |
| DOM / взаимодействия | 186 assertions пройдены, включая 28 Vue compile assertions | [check.mjs](qa/check.mjs), [results.txt](qa/results.txt) |
| Vue typecheck | exit 0; реальные core/web/Nuxt UI типы, без записи в приложение | [typecheck.mjs](qa/typecheck.mjs), [type-results.txt](qa/type-results.txt) |
| Локальные ссылки, JS syntax, placeholders, tokens | 150 checks, 0 failures | [static-results.txt](qa/static-results.txt) |
| Визуальный просмотр | одна матрица действующих экранов: desktop 1366 и mobile 390, EN/RU × light/dark | [visual-review.png](qa/visual-review.png), [visual-review.html](qa/visual-review.html) |
| Сборка приложения / e2e / сервер | не запускались | это референс, не интеграция |

Машинные exit codes: [status.json](qa/status.json). Команды запускаются из корня проекта. Temporary QA-зависимость находится вне приложения.

## Фактические команды

```sh
npm install --prefix /private/tmp/todoer-qa --cache /private/tmp/todoer-npm-cache --no-audit --no-fund happy-dom
"$OD_NODE_BIN" qa/run-checks.mjs
"$OD_NODE_BIN" qa/check.mjs
"$OD_NODE_BIN" qa/static-check.mjs
"$OD_NODE_BIN" qa/typecheck.mjs
"$OD_NODE_BIN" /Users/kkucherenkov/orca/todoer/node_modules/.pnpm/vue-tsc@3.3.11_typescript@5.9.3/node_modules/vue-tsc/bin/vue-tsc.js -p qa/tsconfig.json --noEmit
cmp tokens.css /Users/kkucherenkov/orca/todoer/docs/design/tokens.css
"$OD_NODE_BIN" "$OD_BIN" export qa/visual-review.html --project "$OD_PROJECT_ID" --format image --out qa/visual-review.png
```

Первый npm install без отдельного cache завершился EPERM в пользовательском npm cache; исправлено указанием `/private/tmp/todoer-npm-cache`. Приложение не использовалось для установки зависимостей. Compiler: @vue/compiler-sfc 3.5.43; vue-tsc 3.3.11; TypeScript 5.9.3. Generated tsconfig берёт фактические paths и declarations существующего `.nuxt`, задаёт noEmit, incremental=false и skipLibCheck. strictTemplates включён, checkUnknownProps=false: Nuxt UI принимает HTML aria/data attributes через fallthrough, а отдельный строгий unknown-prop check выдавал ошибки и для неизменённых компонентов источника. Другие проверки типов сохранены. Это проверка SFC и зависимостей в существующем локальном type environment, не Nuxt build.

Промежуточные проверки нашли: отсутствующий calendar utility import, передачу undefined в optional description, попытку добавить README.md в список SFC, устаревший текст о неработающем календаре, отсутствие QA.md до его создания. Исправлено. Итоговые логи содержат последний запуск. В DOM harness structuredClone берётся из Node; настоящие external scripts выполняются вместе в одном Window. Happy DOM не является браузером с layout engine.

## Покрытие взаимодействий

Каждый новый основной flow проходит в EN/RU и light/dark:

- Календарь: October month, scheduled и due на разных датах; перенос due сохраняет scheduled; Undo возвращает исходную дату. Перенос одного вхождения создаёт разовую копию без due и собственного RRULE; Undo удаляет копию и возвращает исходное вхождение. Done-вхождение закрыто, skipped отсутствует; mark Undo восстанавливает дату. Закрытое placement не переносится.
- Календарное меню: фокус первого menuitem; Escape возвращает фокус исходному placement-menu; keyboard Move открывает диалог; cancel event закрывает его и возвращает фокус. Native Escape/trap см. ограничения ниже.
- Представления: create/edit/delete; layout и sort сохранены; broken JSON остаётся в textarea, Save disabled, alert виден; refused save сохраняет draft, повтор успешен. Переключение List/Board не изменяет saved view. Priority и due sorting отдельно проверены; переключение layout не изменяет задачи.
- Повторение: custom RRULE invalid отключает Save; валидное правило даёт preview; refusal оставляет введённый RRULE, retry сохраняет; подзадача не открывает независимое повторение. В Vue Save защищён от повторного submit во время pending.
- Удаление: initial focus на Cancel; Cancel сохраняет родителя и детей; refusal оставляет диалог и задачу; подтверждение удаляет родителя и прямых детей. Undo для delete отсутствует. Initial focus соответствует текущему DeleteTaskDialog источника, а не устаревшему абзацу DESIGN.md.
- Вход/регистрация: только dummy credentials; accepted ведёт в ux.html; mismatch не отправляет форму; ошибка сохраняется в gate. HTML не создаёт серверную сессию. Vue сохраняет реальные db.request и submit-only confirmation.
- Отдельные состояния: offline принимает локальный calendar move и увеличивает очередь; recovery очищает fixture-очередь; refused sync восстанавливается локально. Empty calendar не содержит placements; loading содержит skeleton. Queued/recovery/offline/refused доступны в states.html. Его localStorage изолирован от рабочего прототипа.
- Регрессия иерархии: уникальные task-row IDs, сворачивание не меняет счётчик. Существующая project → task → subtask структура не перестраивалась. Общая проверка предыдущей итерации не выдаётся за повторно выполненную.

## Визуальная и responsive проверка

Матрица показывает реальные HTML/CSS/JS четырёх новых входов и calendar loading, в четырёх комбинациях языка/темы, на desktop 1366 и mobile 390. Проверены видимые области: различимость text/control/background, русские заголовки, границы диалогов, календарные ячейки, отсутствие перекрытия заголовков, видимый drawer под Repeat, light/dark состояния. Макет матрицы намеренно показывает верхние участки iframe; нижние части длинных форм требуют прокрутки и не засчитываются как полностью осмотренные.

После матрицы адресно проверены CSS-изменения календаря: container-type:inline-size, при ширине контейнера ≤850px обе сетки становятся списком дней; полный заголовок даты заменяет номер месяца, menu target 44px. Это устраняет чрезмерно узкие chips и на tablet с sidebar. На desktop используются семь minmax(0,1fr) колонок; длинное название переносится. Мобильный month больше не требует горизонтального скролла. SFC использует соответствующий container breakpoint.

Статически разобраны ограничения новых областей для 360/390/430/600/768/820/1024/1366/1440/1920px: dialog width=min(640px,100%-32px), max-height=100dvh-32px с внутренним overflow:auto, min-width:0 для grid/flex children, fieldset не расширяет форму, filter rows переносятся, date bounds допускают перенос, controls ≥44px. Новые :focus-visible rings используют неизменённый primary. Hover сохраняет foreground и изменяет background; отказ и warning имеют текстовый сигнал. Board сохраняет свой намеренный локальный horizontal scroll.

**Не подтверждено автоматически:** scrollWidth/clientWidth на всех размерах, native tab sequence/trapping, реальная клавиша Escape для browser dialog, touch hit geometry, zoom/экранный диктор, полная прокрутка форм и календаря во всех комбинациях. DOM cancel event и focus-return assertions проверяют обработчики, а не поведение ОС. Визуальная матрица сделана до последних адресных container-query/date-label уточнений; они проверены статически, повторный render не выполнялся. Предыдущая ручная приёмка mobile list/board/drawer пользователем сохраняется, но не покрывает новые экраны.

## Core semantics и честные ограничения fixture

Read-only сверены `operations.ts`: calendarTasks, moveOccurrence, undoMove, setRecurrence, deleteTask/deleteView; web utils/calendar и формы; ADR 0009 о parent occurrence. Source tokens совпадают побайтно.

1. HTML не использует настоящие core projections/operations, worker, SQLite, replay-safe minted opId, серверные версии или outbox. Snapshot parsers/expansion доказывают только локальную валидацию/арифметику.
2. Recurring parent имеет done/skipped marks по дате в календаре. **Recurring child по-прежнему boolean fixture**, без parent-occurrence axis. Повторяющиеся дети в календаре не расширяются как в core. Не переносить это упрощение в приложение.
3. У moved copy нет due, что соответствует core. Но fixture Undo доступен сразу и не проверяет settled/version/queued writes; core undoMove может отказать до синхронизации, при живых детях или исчезнувшем оригинале. Return to series проверяет детей/живой original, но не server version.
4. Core setRule/deleteTask/deleteView требует соответствующего settled/version. Fixture моделирует refusal без реального baseVersion; delete каскадирует прямых детей, но не исполняет атомарный серверный batch. Удаление необратимо.
5. Rule marks в fixture и фильтры по текущей when не заменяют occurrence-aware selected/calendarTasks. Завершение конечной серии и Undo не гарантируют полный core parity во всех комбинациях. Дополнительные raw filters без известного поля остаются problem/raw, не фабрикуются.
6. Frozen today = 2026-10-03. В приложение нужно локальное today и rollover. Auth success — переход в fixture; нет сетевой авторизации, registrationOpen или восстановления реальной сессии.
7. Нет application build/e2e, CSP/offline bundle/hydration проверки, общей реплики Web/TUI или подтверждения другой стороны. Генерируемый typecheck зависит от текущего `.nuxt` и локально установленных source dependencies.

## Оставшаяся приёмка перед интеграцией

В настоящем браузере: все новые экраны и прокрутка форм в EN/RU × light/dark на заданных ширинах; Tab/Shift+Tab, Escape, восстановление фокуса после rerender/delete, touch и contrast measurement. В приложении: compile/build, i18n/CSP, settled refusals, replay-safe retry без новой операции, parent-occurrence completion/progress/Undo, moved-copy Undo до/после sync, смена суток. Task specs фиксируют URL-контекст, transient layout и источник полного прогресса; HTML fixture не является спецификацией engine.

## Точечная правка header: List / Kanban / Calendar

Этот раздел — актуальная проверка единого переключателя. Результаты выше относятся к предыдущему пакету экранов; полные flows и иерархия в этой правке повторно не проверялись.

**Изменены:** ux.html, calendar.html, view-form.html, task-dialogs.html, states.html; ux.css/ux.js и screens.js. Calendar перенесён в общий header tablist, отдельный рабочий вход под заголовком удалён. list.vue/kanban.vue/calendar.vue получили указание общего shell header; добавлены references/ViewHeader.vue и ViewModeTabs.vue. Тела представлений, иерархия, auth и domain/core не менялись.

| Проверка | Результат | Доказательство |
|---|---|---|
| DOM header | 1614 scoped assertions, exit 0 | [header-check.mjs](qa/header-check.mjs), [header-results.txt](qa/header-results.txt) |
| Vue header parse/script/template | два новых SFC, без ошибок; включено в 1614 | тот же лог |
| Vue header typecheck | exit 0 | [header-type-results.txt](qa/header-type-results.txt), [header-tsconfig.json](qa/header-tsconfig.json) |
| Актуальный screenshot | все три active states × EN/RU × light/dark × desktop 1366/mobile 390 | [header-review.png](qa/header-review.png), [матрица](qa/header-review.html) |

Фактические команды текущей правки:

```sh
"$OD_NODE_BIN" qa/header-check.mjs > qa/header-results.txt 2>&1
"$OD_NODE_BIN" /Users/kkucherenkov/orca/todoer/node_modules/.pnpm/vue-tsc@3.3.11_typescript@5.9.3/node_modules/vue-tsc/bin/vue-tsc.js -p qa/header-tsconfig.json --noEmit > qa/header-type-results.txt 2>&1
"$OD_NODE_BIN" "$OD_BIN" export qa/header-review.html --project "$OD_PROJECT_ID" --format image --out qa/header-review.png
```

header-tsconfig.json использует прежние реальные Nuxt/core paths/declarations, но files ограничены двумя новыми header SFC и declarations. noEmit/incremental=false; strictTemplates и прежняя настройка checkUnknownProps=false. Нет изменений или сборки приложения.

DOM matrix: пять рабочих HTML-входов × EN/RU × light/dark × размеры окна 1366/390. Проверены ровно три header tabs; отсутствие отдельного Calendar action; один aria-selected=true и один tabindex=0 для каждого режима; aria-controls/aria-labelledby, title/aria-label; click фокус после rerender; ArrowRight/ArrowLeft с wrap, Home/End; неизменность tasks/filter/saved layout; URL layout. Дополнительно проверена перезагрузка calendar.html с каждым явным layout и сохранением view, task, mode, at. Drawer сохраняется при программной смене режима и повторно открывается по task URL. Клик header под открытым модальным drawer не считается допустимым browser flow и не проверялся как pointer interaction.

Скриншот создан **после финальных изменений header CSS/HTML/JS**. Матрица содержит фактический ux.html с query-параметрами, не перерисованный header. Desktop iframe шириной 1366 масштабирован и обрезан слева, чтобы показать верхнюю панель без sidebar. Mobile iframe имеет реальную ширину 390 без масштаба. Осмотрены все 24 header-фрагмента: три иконки справа, одинаковые размеры и active treatment, читаемые EN/RU заголовки и count, корректные light/dark пары; отдельного Calendar под заголовком нет. В mobile счётчик перенесён во второй ряд, кнопки остаются в первом. Screenshot crop намеренно ограничен header; это не повторная визуальная приёмка тела экрана.

Hover/focus CSS проверен статически: foreground не осветляется, hover меняет neutral background, focus-visible имеет solid primary outline; tooltip фон/текст используют inverted пару в обеих темах, появляются на hover/focus. Размер каждой mode-кнопки 44×44. Active обозначен фоном и нижним индикатором; aria-selected даёт программный сигнал.

**Ограничения:** Happy DOM проверяет обработчики и document.activeElement, но не layout engine, touch geometry, экранный диктор или native Tab/Enter/Space. Enter/Space оставлены стандартным поведением button; Tab sequence задаётся roving tabindex, но полный нативный keyboard прогон не выполнен. Screenshot показывает обычные active states, не hover/focus tooltip capture. Контраст новых токенов численно не измерялся: токены сохранены, цветовые пары проверены статически и визуально. Header Vue compile/typecheck не означает Nuxt integration. Приложение, core, иерархия и чужие активные файлы не изменены.

## Правка P0/P4 и RU/EN после экспорта

2026-10-03: P0 highest, P4 lowest; ascending sort и high preset P0/P1; P0 видим, а не «none». Новый fixture ввод без pN — P4. RU/EN switch отображает обе метки, aria-checked=true означает EN. Обновлены HTML/JS/CSS, Vue-референс языка и design/plan. Production core пока использует старую шкалу — план требует отдельной общей правки и решения совместимости без молчаливой инверсии данных.

Исторические screenshot/QA выше предшествуют этой правке и не подтверждают новое состояние. После правки выполнены адресные Happy DOM assertions приоритета/языка и JS syntax; нативная keyboard/visual проверка switch ещё не выполнена.
