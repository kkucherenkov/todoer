# Утверждённые макеты todoer

Экспорт 2026-10-03 из Open Design `todoer-redesign-8bd9`, Local Codex. Макеты приняты пользователем, включая поправку Calendar в общей группе List/Kanban/Calendar. После экспорта внесены утверждённые правки P0/P4 и RU/EN switch; [export-manifest.json](export-manifest.json) содержит перечень, размеры, SHA-256 и идентификаторы двух завершённых запусков. Исключены служебные artifact sidecars, пустой todo.txt и устаревший index-v2.html.

## Что использовать

- [index.html](index.html) — оглавление и тема; [ux.html](ux.html) — основной связанный прототип списка, доски, календаря и деталей.
- `calendar.html`, `gate.html`, `view-form.html`, `task-dialogs.html` — остальные экраны; [states.html](states.html) — отдельные состояния с изолированным fixture-хранилищем.
- Корневые `.vue` и `references/` — Vue-референсы, включая общий ViewHeader/ViewModeTabs. Переносить в приложение по компонентам, сохраняя реальные операции и контракты.
- `theme/`, `tokens.css`, CSS/JS и `domain/` — тема и зависимости прототипа. Канонические репозиторные [DESIGN.md](../DESIGN.md) и [tokens.css](../tokens.css) остаются отдельными источниками.
- [UX.md](UX.md) — решения; [QA.md](QA.md) — фактические проверки и ограничения; `qa/` — исходники harness, результаты и скриншоты. Актуальный header: [header-review.png](qa/header-review.png); общая матрица: [visual-review.png](qa/visual-review.png).

## Локальный просмотр

Из корня репозитория:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory docs/design/mockups
```

Открыть `http://127.0.0.1:8080/index.html` или `/ux.html`. Open Design для просмотра больше не нужен. HTTP нужен для обычного origin/localStorage. Прототип хранит тестовые данные локально; не вводить настоящие учётные данные в демонстрационную gate-форму.

## Проверки и границы экспорта

Исторические результаты: 186 assertions основного набора, 150 static checks, Vue compile/typecheck; после правки header — 1614 точечных assertions и header compile/typecheck. Экспорт не означает повторного прогона этих проверок в репозитории.

QA-скрипты сохранены как доказательства исходного запуска. В них есть абсолютные пути исходной машины, зависимости `/private/tmp/todoer-qa`, `$OD_NODE_BIN`/`$OD_BIN`, установленный vue-tsc и generated `.nuxt`. Их нельзя считать переносимым CI: перед повтором адаптировать пути и зависимости, а результаты записывать отдельно. Скриншоты уже перенесены и не требуют повторного экспорта через Open Design.

Happy DOM не проверяет нативный Tab/focus trap/touch или полную геометрию. Fixture completion ребёнка повторяющегося родителя, Undo, auth и sync упрощены; production использует core, occurrence axis, settled/version/outbox и реальные отказы. Текст в QA.md об абсолютных путях — история исходной среды.

Материалы исключены из автоматического форматирования; после явных правок manifest обновляется. Новые production-компоненты форматируются и тестируются обычным способом.

Утверждённые правила: [proposal](../../proposals/2026-10-03-web-ux-redesign.md), [task spec](../../../specs/tasks/active/T-2026-10-03-web-redesign-context.md). Порядок внедрения: [план](../../plans/2026-10-03-plan-web-ux-redesign.md).
