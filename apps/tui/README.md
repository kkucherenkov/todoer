# todoer-tui

A keyboard-first terminal client. It uses the CLI's replica and session, so
sign in once with the CLI:

```sh
todoer login you@example.com
todoer-tui
```

`TODOER_URL`, `TODOER_TOKEN` and `TODOER_TIMEOUT_MS` mean what they mean for
the CLI. The bottom line lists the keys of the focused pane, `?` lists them
all; Tab moves the focus and `q` quits. Each pane is drawn in a box and the
focused one is highlighted (a double border under `NO_COLOR`); the smallest
terminal is 60×14. It renders with
`@earendil-works/pi-tui`.

A task's fields are edited where they stand in the detail pane: Enter on a
field opens it in place, Enter saves and Esc cancels (in the notes Alt+Enter
or Shift+Enter starts a new line). A change the server refuses stays on its
field, marked `✗` with the saved value beside yours and the reason; Esc
drops it, and Enter reopens the field with your value to save it again as a
new change. When the server kept no verdict (it refused the request whole,
or could not apply it), `r` sends the same change again. Offline, or refused
for the session or the rate (401, 403, 429), a change is queued instead, and
the status line says why.

`n` (or `o`; `O` for a subtask) opens a new task's row in the outline where
the task will appear; type it in the quick-add grammar (`buy milk #home @shop
p1`), Enter adds it and Esc drops the row. A refused add stays in its row with
the reason, under the same rule: Enter reopens the text, `r` resends it when
the server kept no verdict, Esc drops it.

A kanban view draws the board across the outline and detail columns; Enter
shows the card's details over it and Esc closes them. Below 90 columns it
shows one status column at a time, ←/→ for the next.

Development: `pnpm -w exec turbo run build test --filter=@todoer/tui...`.
Tests need no database.
