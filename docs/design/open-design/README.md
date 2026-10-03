# Open Design и материалы редизайна todoer

Актуальный редизайн выполнен в Local Codex в проекте `todoer-redesign-8bd9`. Пользователь принял макеты 2026-10-03; Calendar включён в единый переключатель List/Kanban/Calendar справа вверху.

Все необходимые исходники перенесены в репозиторий: [снимок и локальный просмотр](../mockups/README.md), [интерактивный прототип](../mockups/ux.html), [QA](../mockups/QA.md), [решения UX](../mockups/UX.md), [manifest](../mockups/export-manifest.json).

[План реализации](../../plans/2026-10-03-plan-web-ux-redesign.md) задаёт порядок переноса; [proposal](../../proposals/2026-10-03-web-ux-redesign.md) и [task spec](../../../specs/tasks/active/T-2026-10-03-web-redesign-context.md) закрепляют поведение.

## Дальнейшая работа

Для просмотра и реализации Open Design больше не требуется. HTML/CSS/JS и Vue-референсы в `mockups/` — источники оформления, не production engine. Переносить компоненты постепенно в `apps/web`, сохраняя core operations, occurrence-aware projections, URL, i18n, CSP, синхронизацию и реальные отказы. Изменённые доступные имена и роли обновлять в тестах осознанно.

Исходное ограничение «только стилизация» заменено утверждённым UX-редизайном. Presets, transient layout, раскрытие детей и прогрессивные поля требуют изменений поведения и task specs. Старые инструкции запуска из source checkout и локальные пути установленных skills не нужны для работы с экспортом.

Если понадобятся новые макеты в Open Design, продолжать существующий проект в явно выбранном Local Codex через доступный Open Design workflow. После правки экспортировать новый снимок с provenance и QA; не выдавать исторические результаты за проверку нового состояния.
