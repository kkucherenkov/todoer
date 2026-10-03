# Vue-референсы todoer

Это комплект для согласования переноса, а не автономное Nuxt-приложение. Источник read-only: `/Users/kkucherenkov/orca/todoer/apps/web/app`. Все изменения находятся в Open Design.

| Основной файл | Локальные supporting SFC | Существующие зависимости приложения |
|---|---|---|
| [calendar.vue](../calendar.vue) | CalendarDay, PlacementChip, MoveDateDialog | useDb, useDayDrag, useFail, utils/calendar, router, core Item/Placement |
| [view-form.vue](../view-form.vue) | FilterTree, FilterNode; DeleteViewDialog для route | useTopic/catalog, utils/filterTree/templates, saveView/deleteView |
| [gate.vue](../gate.vue) | SignInForm, RegisterForm, LocaleSwitch | engine/session topics, registrationOpen, db.request |
| [task-dialogs.vue](../task-dialogs.vue) | DeleteTaskDialog | TaskDetails, core ruleProblem/upcoming, setRule/deleteTask |

Файлы здесь: [CalendarDay](CalendarDay.vue), [PlacementChip](PlacementChip.vue), [MoveDateDialog](MoveDateDialog.vue), [FilterTree](FilterTree.vue), [FilterNode](FilterNode.vue), [DeleteViewDialog](DeleteViewDialog.vue), [DeleteTaskDialog](DeleteTaskDialog.vue), [SignInForm](SignInForm.vue), [RegisterForm](RegisterForm.vue), [LocaleSwitch](LocaleSwitch.vue).

Набор сохраняет реальные write kinds. Calendar MoveDateDialog ждёт `apply` и закрывается после ok; отказ не теряет дату. UI copy, test IDs и Nuxt UI tokens сохранены. При переносе route должен подключить DeleteViewDialog вместо прежнего inline modal, а task-dialogs — обрабатывать close/deleted/deleteClose.

HTML использует fixture и локальные domain snapshots. Vue compilation/typecheck не доказывают работу worker, outbox, сервера, CSP, гидратации или runtime i18n. См. [QA.md](../QA.md).

## Единый header режимов

[ViewHeader.vue](ViewHeader.vue) размещается один раз в правом верхнем углу общего shell; [ViewModeTabs.vue](ViewModeTabs.vue) содержит List / Kanban / Calendar, общий active treatment, 44px targets, EN/RU tooltip/aria, roving tabindex и ArrowLeft/ArrowRight/Home/End. List/board/calendar SFC — тела представлений, поэтому второй переключатель внутрь них не добавлен. Родитель принимает update:layout как временную презентацию, обновляет URL с сохранением query/task и показывает нужное тело. Компонент не вызывает saveView и не переписывает view.layout. HTML хранит board как существующее URL-значение канбана; Vue использует каноническое kanban.
