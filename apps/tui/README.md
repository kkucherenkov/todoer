# todoer-tui

A keyboard-first terminal client. It uses the CLI's replica and session, so
sign in once with the CLI:

```sh
todoer login you@example.com
todoer-tui
```

`TODOER_URL`, `TODOER_TOKEN` and `TODOER_TIMEOUT_MS` mean what they mean for
the CLI. `?` lists the keys; `q` quits.

Development: `pnpm -w exec turbo run build test --filter=@todoer/tui...`.
Tests need no database.
