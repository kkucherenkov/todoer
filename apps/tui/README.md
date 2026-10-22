# todoer-tui

A keyboard-first terminal client. It uses the CLI's replica and session, so
sign in once with the CLI:

```sh
todoer login you@example.com
todoer-tui
```

`TODOER_URL`, `TODOER_TOKEN` and `TODOER_TIMEOUT_MS` mean what they mean for
the CLI. The bottom line lists the keys of the focused pane, `?` lists them
all; Tab moves the focus and `q` quits. It renders with
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

Development: `pnpm -w exec turbo run build test --filter=@todoer/tui...`.
Tests need no database.
