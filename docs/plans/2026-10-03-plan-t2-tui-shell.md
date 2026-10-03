# Plan T2: the terminal client's shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `todoer-tui` starts on the CLI's replica and session, runs the
engine, shows the views in a sidebar and the selected view's tasks as a flat
list, syncs on a cadence, and gives the four feature plans (outline, board,
details, statuses) the shared pieces they build on.

**Architecture:** `apps/tui` is a new workspace package rendered with Ink 8.
`main.tsx` wires the same pieces as the CLI's `index.ts` (store, token source,
transport) into `createEngine` from `@todoer/client-core`. The engine's
`publish` feeds a small topic store that components read with
`useSyncExternalStore`. Screens are plain components; each owns its keys with
`useInput({ isActive })`. The CLI's `openStore` and `readConfig` move into
`@todoer/client-core/node-sqlite` so both Node clients share them.

**Tech Stack:** Ink 8, React 19.3, `ink-text-input` 6, `ink-testing-library`
4, Vitest 5, TypeScript 5.6 (`jsx: react-jsx`), Node 24.

**Spec:** `docs/specs/2026-10-03-tui-client-design.md` (Q1, Q3, Q5, Routine
choices). Requires plan T0 merged (`createEngine` in the core).

## Global Constraints

- Plan T0 is merged: `createEngine`, `Command`, `Write`, `Topics`, `Result`,
  `ALL`, `EngineAuth`, `EngineTokens` come from `@todoer/client-core`.
- New dependencies only in `apps/tui`: `ink@^8.0.0`, `react@^19.3.0`,
  `ink-text-input@^6.0.0`; dev: `@types/react@^19.3.0`,
  `ink-testing-library@^4.0.0`. Nothing else.
- The TUI never owns the session: `todoer login` and `todoer logout` do.
  `TODOER_TOKEN`, `TODOER_URL`, `TODOER_TIMEOUT_MS` mean what they mean for
  the CLI.
- Exit codes: 0 on quit; 3 on an unexpected local failure (the CLI's code).
- Every write goes through `engine.handle` with ids minted by `uuidv7` once
  per user intent, never per retry (ADR 0015 §4).
- Tests need no Postgres and no network.
- Work happens in this plan's own worktree on branch `feat/tui-shell`; never
  on `main`.

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/client-core/src/node-sqlite.ts` | gains `openReplica`, `retryOnBusy`, `readConfig`, `NodeConfig` (moved from the CLI) |
| `apps/cli/src/store.ts`, `apps/cli/src/config.ts` | deleted; their specs stay and import from the core |
| `apps/cli/src/index.ts` | imports from `@todoer/client-core/node-sqlite` |
| `apps/tui/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.mjs` | the package |
| `apps/tui/src/main.tsx` | entry: config, replica, engine, cadence, render, exit code |
| `apps/tui/src/session.ts` | the CLI session as `EngineAuth` + `EngineTokens` |
| `apps/tui/src/topics.ts` | topic store: `publish` in, `useTopic` out |
| `apps/tui/src/context.tsx` | `TuiContext`: engine, topics, `newId`, `today` |
| `apps/tui/src/use-write.ts` | `useWrite()`: mint ids, call the engine, report failures |
| `apps/tui/src/status-line.ts` | the status bar's message state |
| `apps/tui/src/app.tsx` | layout, global keys, current view, screen switching |
| `apps/tui/src/sidebar.tsx` | views list |
| `apps/tui/src/view-pane.tsx` | picks the pane by layout |
| `apps/tui/src/task-keys.tsx` | `useTaskKeys`: the task keys every pane shares (`x`, `s`, `dd`, `e`, `m`, Enter/`i`) |
| `apps/tui/src/flat-list.tsx` | placeholder pane: items, cursor, `o`, plus the shared task keys |
| `apps/tui/src/status-bar.tsx` | sync state, message, key hints |
| `apps/tui/src/ui/picker.tsx`, `line-input.tsx`, `confirm.ts`, `status-picker.tsx` | shared widgets for the feature plans |
| `apps/tui/src/line.ts` | a task as one quick-add line, and the `editTask` changes an edited line makes |
| `apps/tui/src/screens.ts` | the `Screen` union, `PaneProps`, `SCREENS` |
| `apps/tui/src/outline.tsx`, `board.tsx`, `details.tsx`, `statuses.tsx` | stubs, one per feature plan, each replaced wholesale by its plan |
| `apps/tui/src/test-kit.tsx` | test harness: real engine on a temp replica, fake `send` |
| `apps/tui/README.md` | how to run it |

---

### Task 1: Share `openStore` and `readConfig` between the Node clients

**Files:**

- Modify: `packages/client-core/src/node-sqlite.ts`
- Delete: `apps/cli/src/store.ts`, `apps/cli/src/config.ts`
- Modify: `apps/cli/src/index.ts`, `apps/cli/src/store.spec.ts`,
  `apps/cli/src/config.spec.ts`
- Create: `specs/tasks/active/T-2026-10-03-tui-shell.md`

**Interfaces:**

- Produces, from `@todoer/client-core/node-sqlite`:
  - `openReplica(path: string): Store` (the CLI's `openStore`, renamed so it
    does not collide with the core's test-only `openStore`)
  - `retryOnBusy<T>(fn: () => T, sleep?, now?): T`
  - `type NodeConfig = { base: string; token: string; dbPath: string; timeoutMs: number }`
  - `readConfig(env: NodeJS.ProcessEnv): NodeConfig`

- [ ] **Step 1: Write the task spec**

Create `specs/tasks/active/T-2026-10-03-tui-shell.md`:

```md
## T-2026-10-03-tui-shell — Start the terminal client

- Created: 2026-10-03
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: docs/specs/2026-10-03-tui-client-design.md (Q1, Q3, Q5)
- Plan: docs/plans/2026-10-03-plan-t2-tui-shell.md

### Goal

A person who uses the CLI opens `todoer-tui` and sees their views and tasks,
works offline, and stays in sync, on the replica and session the CLI already
has. The outline, board, details and statuses plans build on this shell.

### Scenarios

1. **Given** `todoer login` was run, **When** `todoer-tui` starts, **Then**
   the sidebar lists "All open" and the saved views and the pane lists the
   open tasks.
2. **Given** no session, **When** it starts, **Then** it says to run
   `todoer login` and `q` quits with 0.
3. **Given** the server is down, **When** a task is added, **Then** it shows
   at once and the status bar reads `offline · 1 pending`.
4. **Given** `todoer add x` ran in another shell, **When** the next tick
   passes, **Then** `x` is listed.

### Requirements

- **FR-001** The TUI MUST open the CLI's replica and session (← design Q3)
- **FR-002** The TUI MUST run the core engine and render its topics (← Q5)
- **FR-003** The TUI MUST sync at start, after every write and every 30 s,
  and on `r` (← Routine choices, sync cadence)
- **FR-004** A failure MUST show as one status-bar line; offline is not an
  error (← Routine choices, failures)
- **FR-005** Without a session the TUI MUST say to run `todoer login`
  (← Routine choices, failures)
- **FR-006** The CLI and the TUI MUST share one implementation of opening the
  replica and reading the environment (← maintainer: no duplication)

### Edge cases

- `TODOER_TOKEN` set and no stored session → signed in (FR-001, T002)
- A refresh refused → signed-out screen (FR-005, T002)
- Terminal narrower than 80 columns → sidebar hidden (FR-002, T004)

### Definition of Done

- **SC-001** `todoer-tui` against a live backend lists, adds, completes and
  deletes a task, and the CLI sees each change
- [ ] every FR has a test that failed before the code made it pass
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [ ] T001 [FR-006] move openStore/readConfig into the core — plan Task 1
- [ ] T002 [FR-001] [FR-005] package, session adapter, topics — plan Task 2
- [ ] T003 [FR-002] [FR-004] widgets, write hook, status bar — plan Task 3
- [ ] T004 [FR-002] [FR-003] app, sidebar, flat list, cadence, main — plan Task 4
- [ ] T005 documents and PR — plan Task 5
- **Checkpoint:** feature plans can start on this branch's merge

### Open questions

None.
```

- [ ] **Step 2: Move the code**

Append the bodies of `apps/cli/src/store.ts` (everything except its imports:
`sleepSync`, `retryOnBusy`, `openStore`) and `apps/cli/src/config.ts`
(`Config`, `readConfig`) to `packages/client-core/src/node-sqlite.ts`, then
rename: `openStore` → `openReplica`, `Config` → `NodeConfig`. Add the imports
they need at the top of `node-sqlite.ts`:

```ts
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { UsageError } from './protocol.js';
import { SCHEMA, Store } from './store.js';
```

(`node-sqlite.ts` already imports what `NodeSqlite` and `isSqliteBusy` need;
do not duplicate an import.) Keep every comment that came with the moved
code. Reword the one that says "what a CLI wants here" to "what a Node
client wants here".

```bash
git rm apps/cli/src/store.ts apps/cli/src/config.ts
```

- [ ] **Step 3: Point the CLI and its specs at the core**

`apps/cli/src/index.ts`:

```ts
import { openReplica, readConfig } from '@todoer/client-core/node-sqlite';
```

replacing the two local imports, and `openStore(config.dbPath)` →
`openReplica(config.dbPath)`.

`apps/cli/src/config.spec.ts`: `import { readConfig } from '@todoer/client-core/node-sqlite';`

`apps/cli/src/store.spec.ts`:

1. `import { openReplica as openStore, retryOnBusy } from '@todoer/client-core/node-sqlite';`
2. The "parallel first opens" test compiled the CLI to get `store.js`. Delete
   its `outDir` setup, teardown and `execFileSync(tsc …)` call, and set:

```ts
    // The built entry turbo's `^build` produced before this test ran.
    const storeDist = fileURLToPath(
      import.meta.resolve('@todoer/client-core/node-sqlite'),
    );
```

   and in `workerScript` replace `import { openStore } from …` with
   `import { openReplica as openStore } from ${JSON.stringify(storeDist)};`.
   Remove the now-unused `execFileSync` and `cliDir` if nothing else uses them.

- [ ] **Step 4: Run the CLI's tests through turbo**

Run: `pnpm -w exec turbo run build typecheck test lint --filter=@todoer/cli...`
Expected: PASS. The CLI tests read `packages/client-core/dist`, which is why
this goes through turbo (CLAUDE.md, "Running it").

- [ ] **Step 5: Commit**

```bash
git add -A packages/client-core apps/cli specs/tasks/active
git commit -m "refactor: share replica opening and config between Node clients"
```

---

### Task 2: The package, the session adapter, the topic store

**Files:**

- Create: `apps/tui/package.json`, `apps/tui/tsconfig.json`,
  `apps/tui/tsconfig.build.json`, `apps/tui/vitest.config.mjs`
- Create: `apps/tui/src/session.ts`, `apps/tui/src/session.spec.ts`
- Create: `apps/tui/src/topics.ts`, `apps/tui/src/topics.spec.ts`

**Interfaces:**

- Consumes: `tokenSource`, `httpAuthApi`, `RefusalError`, `EngineAuth`,
  `EngineTokens`, `Store`, `Topic`, `Topics` from `@todoer/client-core`.
- Produces:
  - `cliSession(store: Store, tokens: TokenSource, envToken: string): { auth: EngineAuth; tokens: EngineTokens }`
  - `createTopics(): Topics$` where
    `type Topics$ = { publish<T extends Topic>(t: T, v: Topics[T]): void; get<T extends Topic>(t: T): Topics[T] | undefined; subscribe(fn: () => void): () => void }`
  - `useTopic<T extends Topic>(topics: Topics$, t: T): Topics[T] | undefined`

- [ ] **Step 1: The package files**

`apps/tui/package.json`:

```json
{
  "name": "@todoer/tui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "todoer-tui": "./dist/main.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@todoer/client-core": "workspace:^",
    "@todoer/specs": "workspace:^",
    "ink": "^8.0.0",
    "ink-text-input": "^6.0.0",
    "react": "^19.3.0",
    "uuidv7": "^1.2.1"
  },
  "devDependencies": {
    "@types/node": "^24",
    "@types/react": "^19.3.0",
    "ink-testing-library": "^4.0.0",
    "typescript": "^5.6.3",
    "vitest": "^5.0.2"
  }
}
```

`apps/tui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  // Everything, specs included: this is what `typecheck` and ESLint's
  // type-aware rules read. `build` uses tsconfig.build.json.
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

`apps/tui/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts", "src/**/*.spec.tsx", "src/test-kit.tsx"]
}
```

`apps/tui/vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.{ts,tsx}'],
    // "Today" is the local date (ADR 0010); tests fix the clock in UTC.
    env: { TZ: 'UTC' },
  },
});
```

Run: `pnpm install`
Expected: the lockfile gains the five packages; nothing else changes.

- [ ] **Step 2: Failing tests for the session adapter**

`apps/tui/src/session.spec.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RefusalError, type Store, type TokenSource } from '@todoer/client-core';
import { openReplica } from '@todoer/client-core/node-sqlite';
import { cliSession } from './session.js';

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'todoer-tui-'));
  store = openReplica(join(dir, 'todoer.db'));
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const tokens: TokenSource = {
  current: () => Promise.resolve('access'),
  renew: () => Promise.resolve(null),
};
const saved = {
  accessToken: 'a',
  accessExpiresAt: '2099-01-01T00:00:00.000Z',
  refreshToken: 'r',
};

describe('cliSession', () => {
  it('is signed in with a stored session or an env token, not without', () => {
    expect(cliSession(store, tokens, '').tokens.signedIn()).toBe(false);
    expect(cliSession(store, tokens, 'env').tokens.signedIn()).toBe(true);
    store.saveAuth(saved);
    expect(cliSession(store, tokens, '').tokens.signedIn()).toBe(true);
  });

  it('passes current and renew through', async () => {
    const { tokens: t } = cliSession(store, tokens, '');
    expect(await t.current()).toBe('access');
    expect(await t.renew('x')).toBeNull();
  });

  it('never changes the stored session: adopt and logout do nothing', async () => {
    store.saveAuth(saved);
    const s = cliSession(store, tokens, '');
    s.tokens.adopt(undefined);
    expect(await s.auth.logout('a')).toBeUndefined();
    expect(store.auth()).toEqual(saved);
  });

  it('refuses to sign in, pointing at the CLI', async () => {
    const { auth } = cliSession(store, tokens, '');
    await expect(auth.login('a@b.c', 'x')).rejects.toThrow(RefusalError);
    await expect(auth.login('a@b.c', 'x')).rejects.toThrow(/todoer login/);
    await expect(auth.register('a@b.c', 'x')).rejects.toThrow(/todoer login/);
  });
});
```

Run: `pnpm --filter @todoer/tui exec vitest run src/session.spec.ts`
Expected: FAIL, cannot find `./session.js`.

- [ ] **Step 3: Implement the adapter**

`apps/tui/src/session.ts`:

```ts
import {
  RefusalError,
  type EngineAuth,
  type EngineTokens,
  type Store,
  type TokenSource,
} from '@todoer/client-core';

const USE_CLI = 'sign in with `todoer login`; the TUI uses that session';

/**
 * The CLI's session as the engine sees it. The TUI reads it and renews it
 * (under the store's write lock, so the CLI and the TUI never both spend one
 * refresh token) but never starts or ends it: `todoer login` and
 * `todoer logout` own it. So `adopt` and `logout` change nothing, and the
 * engine's own sign-in is refused with a pointer to the CLI.
 */
export function cliSession(
  store: Store,
  tokens: TokenSource,
  envToken: string,
): { auth: EngineAuth; tokens: EngineTokens } {
  return {
    auth: {
      login: () => Promise.reject(new RefusalError(USE_CLI)),
      register: () => Promise.reject(new RefusalError(USE_CLI)),
      logout: () => Promise.resolve(undefined),
    },
    tokens: {
      current: () => tokens.current(),
      renew: (refused) => tokens.renew(refused),
      adopt: () => undefined,
      signedIn: () => envToken !== '' || store.auth() !== undefined,
    },
  };
}
```

Run: `pnpm --filter @todoer/tui exec vitest run src/session.spec.ts`
Expected: PASS. If the typecheck rejects `login`'s type (the engine's
`login` returns `Promise<AccessGrant | 'invalid'>`), the rejected promise
still satisfies it; annotate with `Promise<never>` only if TypeScript asks.

- [ ] **Step 4: Failing test for the topic store**

`apps/tui/src/topics.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTopics } from './topics.js';

describe('createTopics', () => {
  it('keeps the last value per topic and tells subscribers', () => {
    const topics = createTopics();
    const seen = vi.fn();
    const off = topics.subscribe(seen);
    topics.publish('summary', { tasks: 1 });
    topics.publish('summary', { tasks: 2 });
    expect(topics.get('summary')).toEqual({ tasks: 2 });
    expect(topics.get('catalog')).toBeUndefined();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    topics.publish('summary', { tasks: 3 });
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('keeps one view per key, and one task per id', () => {
    const topics = createTopics();
    const view = (key: string) => ({
      key,
      layout: 'list',
      sort: 'manual',
      problem: null,
      today: '2026-10-03',
      span: null,
      items: [],
      placements: [],
    });
    topics.publish('view', view('a'));
    topics.publish('view', view('b'));
    expect(topics.view('a')?.key).toBe('a');
    expect(topics.view('b')?.key).toBe('b');
    topics.publish('task', { id: 't1', task: null });
    expect(topics.task('t1')).toEqual({ id: 't1', task: null });
  });
});
```

Run: `pnpm --filter @todoer/tui exec vitest run src/topics.spec.ts`
Expected: FAIL, cannot find `./topics.js`.

- [ ] **Step 5: Implement the topic store**

`apps/tui/src/topics.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { Topic, Topics } from '@todoer/client-core';

/**
 * The engine publishes every topic after every change (it does not diff);
 * this keeps the latest of each and wakes React. `view` and `task` are
 * published per key, so those keep one value per key: the TUI watches one
 * view and at most one task, but a stale publish for the previous key must
 * not overwrite the current one.
 */
export type Topics$ = {
  publish<T extends Topic>(topic: T, value: Topics[T]): void;
  get<T extends Topic>(topic: T): Topics[T] | undefined;
  view(key: string): Topics['view'] | undefined;
  task(id: string): Topics['task'] | undefined;
  subscribe(listener: () => void): () => void;
};

export function createTopics(): Topics$ {
  const latest = new Map<Topic, unknown>();
  const views = new Map<string, Topics['view']>();
  const tasks = new Map<string, Topics['task']>();
  const listeners = new Set<() => void>();
  return {
    publish(topic, value) {
      if (topic === 'view') {
        const v = value as Topics['view'];
        views.set(v.key, v);
      } else if (topic === 'task') {
        const t = value as Topics['task'];
        tasks.set(t.id, t);
      } else {
        latest.set(topic, value);
      }
      for (const listener of listeners) listener();
    },
    get: (topic) => latest.get(topic) as never,
    view: (key) => views.get(key),
    task: (id) => tasks.get(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** One topic's latest value; re-renders when anything is published. */
export function useTopic<T extends Topic>(
  topics: Topics$,
  topic: T,
): Topics[T] | undefined {
  return useSyncExternalStore(topics.subscribe, () => topics.get(topic));
}

export function useView(
  topics: Topics$,
  key: string,
): Topics['view'] | undefined {
  return useSyncExternalStore(topics.subscribe, () => topics.view(key));
}

export function useTask(
  topics: Topics$,
  id: string | null,
): Topics['task'] | undefined {
  return useSyncExternalStore(topics.subscribe, () =>
    id === null ? undefined : topics.task(id),
  );
}
```

Run: `pnpm --filter @todoer/tui exec vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/tui pnpm-lock.yaml
git commit -m "feat(tui): add the package, the CLI session adapter and the topic store"
```

---

### Task 3: Shared widgets, the write hook, the status bar

**Files:**

- Create: `apps/tui/src/context.tsx`, `apps/tui/src/status-line.ts`,
  `apps/tui/src/use-write.ts`, `apps/tui/src/status-bar.tsx`
- Create: `apps/tui/src/ui/picker.tsx`, `apps/tui/src/ui/line-input.tsx`,
  `apps/tui/src/ui/confirm.ts`
- Create: `apps/tui/src/test-kit.tsx`
- Test: `apps/tui/src/use-write.spec.tsx`, `apps/tui/src/ui/picker.spec.tsx`,
  `apps/tui/src/status-bar.spec.tsx`

**Interfaces:**

- Consumes: `Engine`, `Write`, `Result`, `Failure`, `Note` from the core;
  `Topics$`, `useTopic` from Task 2.
- Produces (the feature plans use exactly these):
  - `TuiContext` / `useTui(): { engine: Engine; topics: Topics$; newId: () => string; today: () => string; status: StatusLine }`
  - `type StatusLine = { message: Message | null; say(m: Message): void; clear(): void; subscribe(fn: () => void): () => void }`,
    `type Message = { tone: 'info' | 'error'; text: string }`
  - `useWrite(): (build: (newId: () => string) => Write) => Promise<Result>`:
    mints with `newId`, runs `engine.handle`, on failure says
    `failure.detail` as an error unless the kind is `unreachable`; on a
    `note` says what the mark did.
  - `<Picker items={{ id: string; label: string }[]} initial?: string onPick(id) onCancel() />`:
    `j`/`k`/arrows, Enter picks, Esc cancels.
  - `<LineInput initial: string onSubmit(text) onCancel() />`: one line,
    Enter submits, Esc cancels.
  - `confirmKeys(input: string): 'yes' | 'no'`: `y` is yes, anything else no.
  - `renderTui(ui, opts?)` in `test-kit.tsx`: a real engine on a temp
    replica, a fake server, returns `{ lastFrame, stdin, engine, topics, server, cleanup }`.

- [ ] **Step 1: Context and status line**

`apps/tui/src/status-line.ts`:

```ts
export type Message = { tone: 'info' | 'error'; text: string };

/** The one line under the panes: the last thing worth telling, cleared by
 *  the next key a screen handles. */
export type StatusLine = {
  readonly message: Message | null;
  say(message: Message): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
};

export function createStatusLine(): StatusLine {
  let message: Message | null = null;
  const listeners = new Set<() => void>();
  const set = (next: Message | null) => {
    message = next;
    for (const listener of listeners) listener();
  };
  return {
    get message() {
      return message;
    },
    say: set,
    clear: () => message !== null && set(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

`apps/tui/src/context.tsx`:

```tsx
import { createContext, useContext } from 'react';
import type { Engine } from '@todoer/client-core';
import type { StatusLine } from './status-line.js';
import type { Topics$ } from './topics.js';

export type Tui = {
  engine: Engine;
  topics: Topics$;
  newId: () => string;
  /** The local date, YYYY-MM-DD (ADR 0010). */
  today: () => string;
  status: StatusLine;
};

export const TuiContext = createContext<Tui | null>(null);

export function useTui(): Tui {
  const tui = useContext(TuiContext);
  if (tui === null) throw new Error('useTui outside TuiContext');
  return tui;
}
```

- [ ] **Step 2: The test kit**

`apps/tui/src/test-kit.tsx` (excluded from the build):

```tsx
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { render } from 'ink-testing-library';
import type { Change, Op, SyncRequest } from '@todoer/specs';
import {
  createEngine,
  localDate,
  type Engine,
  type Transport,
} from '@todoer/client-core';
import { openReplica } from '@todoer/client-core/node-sqlite';
import { TuiContext } from './context.js';
import { createStatusLine } from './status-line.js';
import { createTopics, type Topics$ } from './topics.js';

export const NOW = new Date('2026-10-03T10:00:00.000Z');

/** A server that applies every op once and serves the rows it holds;
 *  `offline` makes every request fail like a dropped connection. */
export function fakeServer(rows: Change['row'][] = []) {
  const changes: Change[] = rows.map((row, i) => ({
    table: String(row.table ?? 'task'),
    id: String(row.id),
    seq: i + 1,
    row: { deletedAt: null, ...row },
  }));
  const sent: Op[] = [];
  const state = { offline: false };
  const seen = new Set<string>();
  const send: Transport = (request: SyncRequest) => {
    if (state.offline) return Promise.reject(new TypeError('fetch failed'));
    for (const op of request.ops) {
      sent.push(op);
      if (seen.has(op.opId)) continue;
      seen.add(op.opId);
      const seq = changes.length + 1;
      if (op.kind === 'create') {
        changes.push({
          table: op.table,
          id: op.id,
          seq,
          row: { id: op.id, deletedAt: null, version: 1, ...op.fields },
        });
      } else if (op.kind === 'set') {
        const prev = [...changes].reverse().find((c) => c.id === op.id);
        changes.push({
          table: op.table,
          id: op.id,
          seq,
          row: { ...(prev?.row ?? { id: op.id }), [op.field]: op.value },
        });
      } else if (op.kind === 'delete') {
        const prev = [...changes].reverse().find((c) => c.id === op.id);
        changes.push({
          table: op.table,
          id: op.id,
          seq,
          row: { ...(prev?.row ?? { id: op.id }), deletedAt: NOW.toISOString() },
        });
      }
    }
    const body = {
      cursor: changes.length,
      results: request.ops.map((op) => ({ opId: op.opId, status: 'applied' })),
      changes: changes.filter((c) => c.seq > request.since),
    };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { send, sent, state };
}

const TOKEN = `${btoa(JSON.stringify({ sub: 'u1' })).replace(/=+$/, '')}.mac`;

/** Renders `ui` inside a real engine, signed in as u1 on a temp replica. */
export async function renderTui(
  ui: ReactNode,
  { server = fakeServer() }: { server?: ReturnType<typeof fakeServer> } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'todoer-tui-test-'));
  const store = openReplica(join(dir, 'todoer.db'));
  store.saveAuth({
    accessToken: TOKEN,
    accessExpiresAt: '2099-01-01T00:00:00.000Z',
    refreshToken: 'r',
  });
  const topics: Topics$ = createTopics();
  let n = 0;
  const newId = () =>
    `00000000-0000-7000-8000-${(n += 1).toString(16).padStart(12, '0')}`;
  const engine: Engine = createEngine({
    store,
    auth: {
      login: () => Promise.reject(new Error('no')),
      register: () => Promise.reject(new Error('no')),
      logout: () => Promise.resolve(undefined),
    },
    tokens: {
      current: () => Promise.resolve(TOKEN),
      renew: () => Promise.resolve(null),
      adopt: () => undefined,
      signedIn: () => true,
    },
    send: server.send,
    now: () => NOW,
    newId,
    publish: (topic, value) => topics.publish(topic, value),
  });
  await engine.start(true);
  const status = createStatusLine();
  const tui = { engine, topics, newId, today: () => localDate(NOW), status };
  const rendered = render(
    <TuiContext.Provider value={tui}>{ui}</TuiContext.Provider>,
  );
  /** Lets publishes and effects settle before a frame is read. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  await settle();
  return {
    ...rendered,
    ...tui,
    store,
    server,
    settle,
    /** Types `keys` one write at a time, settling after each. */
    async press(...keys: string[]) {
      for (const key of keys) {
        rendered.stdin.write(key);
        await settle();
      }
    },
    cleanup() {
      rendered.unmount();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Raw sequences for keys `press` cannot spell as text. */
export const KEY = {
  enter: '\r',
  escape: '\u001b',
  up: '\u001b[A',
  down: '\u001b[B',
  right: '\u001b[C',
  left: '\u001b[D',
  tab: '\t',
  shiftTab: '\u001b[Z',
  altUp: '\u001b\u001b[A',
  altDown: '\u001b\u001b[B',
} as const;
```

- [ ] **Step 3: Failing tests for the write hook and the picker**

`apps/tui/src/use-write.spec.tsx`:

```tsx
import { Text } from 'ink';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_OPEN, viewTasks } from '@todoer/client-core';
import { renderTui } from './test-kit.js';
import { useWrite } from './use-write.js';

let cleanup = () => {};
afterEach(() => cleanup());

function Adds({ text }: { text: string }) {
  const write = useWrite();
  const [done, setDone] = useState('');
  useEffect(() => {
    void write((newId) => ({
      kind: 'add',
      opId: newId(),
      id: newId(),
      text,
    })).then((r) => setDone(r.ok ? 'ok' : 'failed'));
  }, []);
  return <Text>{done}</Text>;
}

describe('useWrite', () => {
  it('runs the write through the engine', async () => {
    const t = await renderTui(<Adds text="milk" />);
    cleanup = t.cleanup;
    await t.settle();
    expect(t.lastFrame()).toBe('ok');
    expect(
      viewTasks(t.store, '2026-10-03', ALL_OPEN).map((i) => i.title),
    ).toEqual(['milk']);
  });

  it('says a refusal on the status line', async () => {
    const t = await renderTui(<Adds text="   " />);
    cleanup = t.cleanup;
    await t.settle();
    expect(t.lastFrame()).toBe('failed');
    expect(t.status.message?.tone).toBe('error');
  });

  it('says nothing when the server is merely unreachable', async () => {
    const t = await renderTui(<Adds text="offline" />);
    cleanup = t.cleanup;
    t.server.state.offline = true;
    await t.settle();
    expect(t.status.message).toBeNull();
  });
});
```

(If the engine answers an empty title with something other than a failure,
check `add`'s `planAdd` and pick an input it refuses; keep the assertion that
a refusal reaches the status line.)

`apps/tui/src/ui/picker.spec.tsx`:

```tsx
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { KEY } from '../test-kit.js';
import { Picker } from './picker.js';

const tick = () => new Promise((r) => setTimeout(r, 10));

describe('Picker', () => {
  it('moves with j/k and arrows, picks with Enter', async () => {
    const onPick = vi.fn();
    const { stdin, lastFrame } = render(
      <Picker
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
          { id: 'c', label: 'Gamma' },
        ]}
        onPick={onPick}
        onCancel={() => {}}
      />,
    );
    expect(lastFrame()).toContain('› Alpha');
    stdin.write('j');
    await tick();
    stdin.write(KEY.down);
    await tick();
    expect(lastFrame()).toContain('› Gamma');
    stdin.write('k');
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onPick).toHaveBeenCalledWith('b');
  });

  it('starts on `initial` and cancels with Esc', async () => {
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      <Picker
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ]}
        initial="b"
        onPick={() => {}}
        onCancel={onCancel}
      />,
    );
    expect(lastFrame()).toContain('› Beta');
    stdin.write(KEY.escape);
    await tick();
    expect(onCancel).toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @todoer/tui exec vitest run`
Expected: FAIL, missing modules.

- [ ] **Step 4: Implement the hook and the widgets**

`apps/tui/src/use-write.ts`:

```ts
import { useCallback } from 'react';
import type { Note, Result, Write } from '@todoer/client-core';
import { useTui } from './context.js';

const noteText = (note: Note) =>
  note.next === null
    ? `marked ${note.marked}`
    : `marked ${note.marked} · next ${note.next}`;

/**
 * Every write a screen makes. `build` mints its ids once, here, so the
 * write is one intent however often the engine retries it (ADR 0015 §4).
 * A refusal is said on the status line; being offline is not: the write is
 * queued and the status bar already shows the pending count.
 */
export function useWrite(): (
  build: (newId: () => string) => Write,
) => Promise<Result> {
  const { engine, newId, status } = useTui();
  return useCallback(
    async (build) => {
      const result = await engine.handle(build(newId), 'tui');
      if (!result.ok) {
        if (result.failure.kind !== 'unreachable') {
          status.say({ tone: 'error', text: result.failure.detail });
        }
      } else if (result.note !== undefined) {
        status.say({ tone: 'info', text: noteText(result.note) });
      }
      return result;
    },
    [engine, newId, status],
  );
}
```

`apps/tui/src/ui/picker.tsx`:

```tsx
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';

export type PickerItem = { id: string; label: string };

/** A vertical choice: j/k or arrows move, Enter picks, Esc cancels. */
export function Picker({
  items,
  initial,
  onPick,
  onCancel,
  title,
}: {
  items: PickerItem[];
  initial?: string;
  onPick: (id: string) => void;
  onCancel: () => void;
  title?: string;
}) {
  const start = Math.max(
    0,
    items.findIndex((i) => i.id === initial),
  );
  const [at, setAt] = useState(start);
  useInput((input, key) => {
    if (key.escape) return onCancel();
    if (key.return) {
      const item = items[at];
      if (item !== undefined) onPick(item.id);
      return;
    }
    if (input === 'j' || key.downArrow) {
      setAt((i) => Math.min(items.length - 1, i + 1));
    }
    if (input === 'k' || key.upArrow) setAt((i) => Math.max(0, i - 1));
  });
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {title === undefined ? null : <Text bold>{title}</Text>}
      {items.map((item, i) => (
        <Text key={item.id} inverse={i === at}>
          {i === at ? '› ' : '  '}
          {item.label}
        </Text>
      ))}
    </Box>
  );
}
```

`apps/tui/src/ui/line-input.tsx`:

```tsx
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useState } from 'react';

/** One editable line: Enter submits, Esc cancels. */
export function LineInput({
  initial,
  onSubmit,
  onCancel,
  label,
}: {
  initial: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  label?: string;
}) {
  const [value, setValue] = useState(initial);
  useInput((_input, key) => {
    if (key.escape) onCancel();
  });
  return (
    <Box>
      {label === undefined ? null : <Text dimColor>{label} </Text>}
      <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
    </Box>
  );
}
```

`apps/tui/src/ui/confirm.ts`:

```ts
/** A destructive key asks once on the status line; only `y` confirms. */
export const confirmKeys = (input: string): 'yes' | 'no' =>
  input === 'y' ? 'yes' : 'no';
```

- [ ] **Step 5: The status bar, test first**

`apps/tui/src/status-bar.spec.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBar } from './status-bar.js';
import { renderTui } from './test-kit.js';

let cleanup = () => {};
afterEach(() => cleanup());

describe('StatusBar', () => {
  it('shows synced, then offline with the pending count', async () => {
    const t = await renderTui(<StatusBar hints="q quit" />);
    cleanup = t.cleanup;
    expect(t.lastFrame()).toMatch(/synced/);
    t.server.state.offline = true;
    await t.engine.handle(
      { kind: 'add', opId: t.newId(), id: t.newId(), text: 'x' },
      'tui',
    );
    await t.settle();
    expect(t.lastFrame()).toMatch(/offline · 1 pending/);
  });

  it('shows the status line message over the hints', async () => {
    const t = await renderTui(<StatusBar hints="q quit" />);
    cleanup = t.cleanup;
    t.status.say({ tone: 'error', text: 'no task x' });
    await t.settle();
    expect(t.lastFrame()).toMatch(/no task x/);
    expect(t.lastFrame()).not.toMatch(/q quit/);
  });
});
```

`apps/tui/src/status-bar.tsx`:

```tsx
import { Box, Text } from 'ink';
import { useSyncExternalStore } from 'react';
import { useTui } from './context.js';
import { useTopic } from './topics.js';

/** Sync state on the left; the status line's message, else key hints. */
export function StatusBar({ hints }: { hints: string }) {
  const { topics, status } = useTui();
  const sync = useTopic(topics, 'sync');
  const message = useSyncExternalStore(status.subscribe, () => status.message);
  const state =
    sync === undefined
      ? 'starting'
      : sync.running
        ? 'syncing…'
        : sync.reached === false
          ? `offline · ${sync.pending} pending`
          : sync.pending > 0
            ? `${sync.pending} pending`
            : 'synced';
  const failed = sync !== undefined && sync.failed > 0 ? ` · ${sync.failed} failed` : '';
  return (
    <Box justifyContent="space-between">
      <Text dimColor>
        {state}
        {failed}
      </Text>
      {message === null ? (
        <Text dimColor>{hints}</Text>
      ) : (
        <Text color={message.tone === 'error' ? 'red' : 'green'}>
          {message.text}
        </Text>
      )}
    </Box>
  );
}
```

Run: `pnpm --filter @todoer/tui exec vitest run`
Expected: PASS.

- [ ] **Step 6: The line codec, test first**

The outline and board plans both edit a task's line in place. The grammar
is quick-add's (`parseQuickAdd`): tags are stored with their `@`
(`labels.ts`: "`@phone` is stored as `@phone`"), the project without its
`#`.

`apps/tui/src/line.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lineChanges, lineOf } from './line.js';

const item = {
  title: 'milk',
  tags: ['@shop'],
  project: 'home',
  priority: 2,
};

describe('lineOf', () => {
  it('writes title, tags, project and priority as quick-add reads them', () => {
    expect(lineOf(item)).toBe('milk @shop #home p2');
    expect(lineOf({ title: 'x', tags: [], project: null, priority: 0 })).toBe('x');
  });
});

describe('lineChanges', () => {
  it('is empty for an unchanged line', () => {
    expect(lineChanges(item, 'milk @shop #home p2')).toEqual({});
  });

  it('names only what changed', () => {
    expect(lineChanges(item, 'oat milk @shop #home p2')).toEqual({
      title: 'oat milk',
    });
    expect(lineChanges(item, 'milk @shop @dairy #home p2')).toEqual({
      tags: ['@shop', '@dairy'],
    });
    expect(lineChanges(item, 'milk @shop p2')).toEqual({ project: null });
    expect(lineChanges(item, 'milk @shop #home')).toEqual({ priority: 0 });
  });

  it('compares tags as a set', () => {
    const two = { ...item, tags: ['@a', '@b'] };
    expect(lineChanges(two, 'milk @b @a #home p2')).toEqual({});
  });
});
```

`apps/tui/src/line.ts`:

```ts
import { parseQuickAdd, type TaskChanges } from '@todoer/client-core';

export type LineFields = {
  title: unknown;
  tags: string[];
  project: string | null;
  priority: unknown;
};

/** A task as one quick-add line: `title @tags #project pN`. */
export function lineOf(item: LineFields): string {
  const priority = Number(item.priority ?? 0);
  return [
    String(item.title),
    ...item.tags,
    ...(item.project === null ? [] : [`#${item.project}`]),
    ...(priority > 0 ? [`p${priority}`] : []),
  ].join(' ');
}

/** What an edited line changes, field by field; `{}` when nothing did. */
export function lineChanges(item: LineFields, line: string): TaskChanges {
  const parsed = parseQuickAdd(line);
  const changes: TaskChanges = {};
  if (parsed.title !== String(item.title)) changes.title = parsed.title;
  const before = new Set(item.tags);
  if (
    parsed.tags.length !== before.size ||
    parsed.tags.some((t) => !before.has(t))
  ) {
    changes.tags = parsed.tags;
  }
  const project = parsed.project ?? null;
  if (project !== item.project) changes.project = project;
  if (parsed.priority !== Number(item.priority ?? 0)) {
    changes.priority = parsed.priority;
  }
  return changes;
}
```

(An empty title is passed through: `editTask` refuses it and the refusal
reaches the status line through `useWrite`.)

- [ ] **Step 7: The status picker**

`m` opens it from the outline and the board; it lists the statuses and
writes one `move` with `statusId`.

`apps/tui/src/ui/status-picker.tsx`:

```tsx
import { useEffect } from 'react';
import { ALL } from '@todoer/client-core';
import { useTui } from '../context.js';
import { useTopic } from '../topics.js';
import { useWrite } from '../use-write.js';
import { Picker } from './picker.js';

/** Moves `taskId` to the picked status; closes either way. Moving into the
 *  completing status marks the task done (the engine's `move`). */
export function StatusPicker({
  taskId,
  current,
  view,
  onDone,
}: {
  taskId: string;
  current: string | null;
  /** The view the move happens in, or `ALL`. */
  view: string;
  onDone: () => void;
}) {
  const { topics, status } = useTui();
  const write = useWrite();
  const statuses = useTopic(topics, 'catalog')?.statuses ?? [];
  const none = statuses.length === 0;
  useEffect(() => {
    if (!none) return;
    status.say({ tone: 'info', text: 'no statuses yet — S to add one' });
    onDone();
  }, [none]);
  if (none) return null;
  return (
    <Picker
      title="Status"
      items={statuses.map((s) => ({
        id: s.id,
        label: s.completing ? `${s.name} ✓` : s.name,
      }))}
      {...(current === null ? {} : { initial: current })}
      onCancel={onDone}
      onPick={(statusId) => {
        onDone();
        void write((newId) => ({
          kind: 'move',
          opId: newId(),
          taskId,
          view: view || ALL,
          statusId,
        }));
      }}
    />
  );
}
```

Test it in `apps/tui/src/ui/status-picker.spec.tsx` with `renderTui`: a
status `s1` "To do", a completing status `s2` "Done", a task `t1` in `s1`;
render `<StatusPicker taskId="t1" current="s1" view="all" onDone={…} />`,
press `j`, Enter, then assert the task's row in the replica has
`statusId: 's2'` (`t.store.rows('task')`) and that `onDone` ran.

- [ ] **Step 8: Commit**

```bash
git add apps/tui
git commit -m "feat(tui): add the write hook, the status bar and shared widgets"
```

---

### Task 4: The app, the sidebar, a flat list, the cadence, `main`

**Files:**

- Create: `apps/tui/src/screens.ts`, `apps/tui/src/app.tsx`,
  `apps/tui/src/sidebar.tsx`, `apps/tui/src/view-pane.tsx`,
  `apps/tui/src/flat-list.tsx`, `apps/tui/src/main.tsx`
- Test: `apps/tui/src/app.spec.tsx`

**Interfaces:**

- Consumes: everything from Tasks 2–3; `ALL`, `localDate`, `httpAuthApi`,
  `httpTransport`, `tokenSource` from the core; `openReplica`, `readConfig`
  from `@todoer/client-core/node-sqlite`.
- Produces, for the feature plans:
  - `type PaneProps = { view: Topics['view']; active: boolean; open(screen: Screen): void }`:
    every pane component takes these.
  - `type Screen = { kind: 'view' } | { kind: 'details'; taskId: string } | { kind: 'statuses' }`
  - `useTaskKeys({ current: Item | undefined; viewKey: string; open(s: Screen): void }): { handle(input: string, key: Key): boolean; overlay: ReactNode; busy: boolean }`
    in `task-keys.tsx`: call `handle` first in a pane's `useInput`; render
    `overlay`; pass `isActive: … && !busy`.
  - Stub files, one per feature plan, each replaced wholesale by its plan:
    `outline.tsx` exports `OutlinePane: ComponentType<PaneProps>`;
    `board.tsx` exports `BoardPane: ComponentType<PaneProps>`;
    `details.tsx` exports `DetailsScreen: ((p: { taskId: string; close(): void }) => ReactNode) | undefined`;
    `statuses.tsx` exports `StatusesScreen: ((p: { close(): void }) => ReactNode) | undefined`.
  - `SCREENS` in `screens.ts` and `PANES` in `view-pane.tsx` read those
    exports; no feature plan edits them.
  - Global keys owned by `App`: `[` `]` (views), `v` (view picker), `r`
    (sync), `?` (help), `q` (quit), `S` (statuses), and Tab only to toggle
    focus when the sidebar is shown **is not used** (Tab belongs to indent).

- [ ] **Step 1: Failing app test**

`apps/tui/src/app.spec.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './app.js';
import { fakeServer, KEY, renderTui } from './test-kit.js';

let cleanup = () => {};
afterEach(() => cleanup());

const status = {
  table: 'status',
  id: 's1',
  name: 'To do',
  rank: 'a0',
  completing: false,
  version: 1,
};
const view = {
  table: 'view',
  id: 'v1',
  name: 'Mine',
  layout: 'list',
  sort: 'manual',
  filter: { all: [] },
  rank: 'a0',
  version: 1,
};
const task = (id: string, title: string, rank = 'a0') => ({
  table: 'task',
  id,
  title,
  rank,
  priority: 0,
  version: 1,
});

describe('App', () => {
  it('lists views and the open tasks', async () => {
    const t = await renderTui(<App />, {
      server: fakeServer([status, view, task('t1', 'milk')]),
    });
    cleanup = t.cleanup;
    await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
    await t.settle();
    const frame = t.lastFrame() ?? '';
    expect(frame).toContain('All open');
    expect(frame).toContain('Mine');
    expect(frame).toContain('milk');
  });

  it('adds with o, completes with x, deletes with dd y', async () => {
    const t = await renderTui(<App />, { server: fakeServer([status]) });
    cleanup = t.cleanup;
    await t.press('o', 'bread', KEY.enter);
    expect(t.lastFrame()).toContain('bread');
    await t.press('x');
    expect(t.lastFrame()).not.toContain('bread');
    await t.press('o', 'jam', KEY.enter, 'd', 'd', 'y');
    expect(t.lastFrame()).not.toContain('jam');
  });

  it('switches views with ] and [', async () => {
    const t = await renderTui(<App />, {
      server: fakeServer([status, view, task('t1', 'milk')]),
    });
    cleanup = t.cleanup;
    await t.engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
    await t.press(']');
    expect(t.lastFrame()).toMatch(/Mine/);
    await t.press('[');
    expect(t.lastFrame()).toMatch(/All open/);
  });
});
```

(The filter `{ all: [] }` must satisfy `filterProblem`; if the core rejects
it, read `filterProblem` in `@todoer/specs` and use the smallest filter it
accepts. The fake server serves rows to any `since`, so the first `start`
sync already pulls them; the explicit `sync` makes the order certain.)

Run: `pnpm --filter @todoer/tui exec vitest run src/app.spec.tsx`
Expected: FAIL, cannot find `./app.js`.

- [ ] **Step 2: Screens and panes**

`apps/tui/src/screens.ts`:

```ts
import type { Topics } from '@todoer/client-core';

export type Screen =
  | { kind: 'view' }
  | { kind: 'details'; taskId: string }
  | { kind: 'statuses' };

/** What every pane gets: the view it shows, whether keys are its, and a way
 *  to open another screen. */
export type PaneProps = {
  view: Topics['view'];
  active: boolean;
  open: (screen: Screen) => void;
};

// SCREENS (the details and statuses screens) is defined below, after the
// stub files it imports.
```

`apps/tui/src/task-keys.tsx` holds the keys every pane shares, so the
outline, the board and the flat list handle them one way:

```tsx
import type { Key } from 'ink';
import { useRef, useState, type ReactNode } from 'react';
import type { Item } from '@todoer/client-core';
import { useTui } from './context.js';
import { lineChanges, lineOf } from './line.js';
import type { Screen } from './screens.js';
import { confirmKeys } from './ui/confirm.js';
import { LineInput } from './ui/line-input.js';
import { StatusPicker } from './ui/status-picker.js';
import { useWrite } from './use-write.js';

/**
 * The task keys every pane shares: `x`/Space done or undo, `s` skip, `dd`
 * then `y` delete, `e` details, `m` status, Enter/`i` edit the line in
 * place. A pane calls `handle` first in its own `useInput` and stops when it
 * returns true; it renders `overlay` (an editor or a picker) and gives its
 * own keys up while `busy`.
 */
export function useTaskKeys({
  current,
  viewKey,
  open,
}: {
  current: Item | undefined;
  viewKey: string;
  open: (screen: Screen) => void;
}): {
  handle: (input: string, key: Key) => boolean;
  overlay: ReactNode;
  busy: boolean;
} {
  const { status } = useTui();
  const write = useWrite();
  const [mode, setMode] = useState<'idle' | 'edit' | 'status' | 'delete'>(
    'idle',
  );
  // `dd`: the first `d` waits for a second; any other key forgets it.
  const pendingD = useRef(false);
  const idle = () => setMode('idle');

  const handle = (input: string, key: Key): boolean => {
    if (mode === 'delete') {
      idle();
      status.clear();
      if (confirmKeys(input) === 'yes' && current !== undefined) {
        void write((newId) => ({
          kind: 'deleteTask',
          opId: newId(),
          taskId: String(current.id),
        }));
      }
      return true;
    }
    if (mode !== 'idle' || current === undefined) return false;
    const taskId = String(current.id);
    if (input === 'd') {
      if (!pendingD.current) {
        pendingD.current = true;
        return true;
      }
      pendingD.current = false;
      setMode('delete');
      status.say({
        tone: 'info',
        text: `delete "${String(current.title)}"? y/n`,
      });
      return true;
    }
    pendingD.current = false;
    if (input === 'x' || input === ' ') {
      void write((newId) => ({
        kind: 'mark',
        opId: newId(),
        taskId,
        mark: current.closed ? 'undo' : 'done',
      }));
    } else if (input === 's') {
      void write((newId) => ({ kind: 'mark', opId: newId(), taskId, mark: 'skip' }));
    } else if (input === 'e') {
      open({ kind: 'details', taskId });
    } else if (input === 'm') {
      setMode('status');
    } else if (input === 'i' || key.return) {
      setMode('edit');
    } else {
      return false;
    }
    return true;
  };

  const overlay =
    current === undefined ? null : mode === 'edit' ? (
      <LineInput
        label="edit:"
        initial={lineOf(current)}
        onCancel={idle}
        onSubmit={(line) => {
          const changes = lineChanges(current, line);
          if (Object.keys(changes).length === 0) return idle();
          // Open until the write is taken: a refusal keeps the text.
          void write((newId) => ({
            kind: 'edit',
            opId: newId(),
            taskId: String(current.id),
            changes,
          })).then((r) => r.ok && idle());
        }}
      />
    ) : mode === 'status' ? (
      <StatusPicker
        taskId={String(current.id)}
        current={current.column}
        view={viewKey}
        onDone={idle}
      />
    ) : null;

  return { handle, overlay, busy: mode === 'edit' || mode === 'status' };
}
```

`apps/tui/src/flat-list.tsx`:

```tsx
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { useTui } from './context.js';
import type { PaneProps } from './screens.js';
import { useTaskKeys } from './task-keys.js';
import { LineInput } from './ui/line-input.js';
import { useWrite } from './use-write.js';

/**
 * The shell's pane: one row per item, no nesting. The outline and board
 * stubs point at it until their plans land.
 */
export function FlatList({ view, active, open }: PaneProps) {
  const { status } = useTui();
  const write = useWrite();
  const [at, setAt] = useState(0);
  const [adding, setAdding] = useState(false);
  const items = view.items;
  const current = items[Math.min(at, items.length - 1)];
  const keys = useTaskKeys({ current, viewKey: view.key, open });

  useInput(
    (input, key) => {
      // Not before `handle`: it would erase the delete question before `y`.
      if (keys.handle(input, key)) return;
      status.clear();
      if (input === 'j' || key.downArrow) {
        setAt((i) => Math.min(items.length - 1, i + 1));
      } else if (input === 'k' || key.upArrow) {
        setAt((i) => Math.max(0, i - 1));
      } else if (input === 'o') {
        setAdding(true);
      }
    },
    { isActive: active && !adding && !keys.busy },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {items.length === 0 ? <Text dimColor>nothing here</Text> : null}
      {items.map((item, i) => (
        <Text key={String(item.id)} inverse={active && i === at}>
          {item.closed ? '✓ ' : '  '}
          {item.parentTitle === null ? '' : `${item.parentTitle} › `}
          {String(item.title)}
        </Text>
      ))}
      {keys.overlay}
      {adding ? (
        <LineInput
          label="new:"
          initial=""
          onCancel={() => setAdding(false)}
          onSubmit={(text) => {
            // Open until the write is taken: a refusal keeps the text.
            void write((newId) => ({
              kind: 'add',
              opId: newId(),
              id: newId(),
              text,
            })).then((r) => r.ok && setAdding(false));
          }}
        />
      ) : null}
    </Box>
  );
}
```

Every `LineInput` in the TUI follows this rule: it closes when its write is
taken (`result.ok`, offline included, since a queued write is taken) and
stays open with the typed text on a refusal, whose reason the status line
shows (web redesign proposal: an error does not clear the input).

Add to `apps/tui/src/app.spec.tsx`:

```tsx
  it('edits a line in place with Enter', async () => {
    const t = await renderTui(<App />, { server: fakeServer([status]) });
    cleanup = t.cleanup;
    await t.press('o', 'bread', KEY.enter, KEY.enter);
    // The editor opens on "bread"; move to its end and type.
    await t.press(' @shop', KEY.enter);
    expect(t.lastFrame()).toContain('bread');
    const row = t.store.rows('task').find((r) => r.title === 'bread');
    expect(row).toBeDefined();
  });
```

(The tag lands on the task through `task_tag`; asserting the title stays
"bread" and the edit did not fail is enough here; `line.spec.ts` pins the
codec.)


The four feature plans run in parallel, so each owns exactly one file the
shell creates as a stub, and nothing else in the shell changes:

`apps/tui/src/outline.tsx` (replaced by the outline plan):

```tsx
/** Stub until the outline plan lands: the list layout as a flat list. */
export { FlatList as OutlinePane } from './flat-list.js';
```

`apps/tui/src/board.tsx` (replaced by the board plan):

```tsx
/** Stub until the board plan lands: the kanban layout as a flat list. */
export { FlatList as BoardPane } from './flat-list.js';
```

`apps/tui/src/details.tsx` (replaced by the details plan):

```tsx
import type { ReactNode } from 'react';

/** Stub until the details plan lands: no details screen yet. */
export const DetailsScreen:
  | ((p: { taskId: string; close: () => void }) => ReactNode)
  | undefined = undefined;
```

`apps/tui/src/statuses.tsx` (replaced by the statuses plan):

```tsx
import type { ReactNode } from 'react';

/** Stub until the statuses plan lands: no statuses screen yet. */
export const StatusesScreen: ((p: { close: () => void }) => ReactNode) | undefined =
  undefined;
```

Then `SCREENS` in `screens.ts` reads them instead of being an empty object:

```ts
import { DetailsScreen } from './details.js';
import { StatusesScreen } from './statuses.js';

export const SCREENS = { details: DetailsScreen, statuses: StatusesScreen };
```

(`screens.ts` then imports `details.tsx`, which must not import `screens.ts`
back for anything but types; keep `Screen` and `PaneProps` type-only there.)

`apps/tui/src/view-pane.tsx`:

```tsx
import { Text } from 'ink';
import type { ComponentType } from 'react';
import { BoardPane } from './board.js';
import { OutlinePane } from './outline.js';
import type { PaneProps } from './screens.js';

/** One pane per layout; calendar is not in v1. */
export const PANES: Record<string, ComponentType<PaneProps>> = {
  list: OutlinePane,
  kanban: BoardPane,
};

export function ViewPane(props: PaneProps) {
  const { view } = props;
  if (view.problem !== null) {
    return <Text color="yellow">this view cannot be shown: {view.problem}</Text>;
  }
  const Pane = PANES[view.layout];
  if (Pane === undefined) {
    return <Text dimColor>the {view.layout} layout is not in the TUI yet</Text>;
  }
  return <Pane {...props} />;
}
```

- [ ] **Step 3: Sidebar and app**

`apps/tui/src/sidebar.tsx`:

```tsx
import { Box, Text } from 'ink';
import type { Catalog } from '@todoer/client-core';
import { ALL } from '@todoer/client-core';

export type ViewEntry = { key: string; name: string };

/** "All open" first, then the saved views by rank (catalog order). */
export const viewEntries = (catalog: Catalog | undefined): ViewEntry[] => [
  { key: ALL, name: 'All open' },
  ...(catalog?.views ?? []).map((v) => ({ key: v.id, name: v.name })),
];

export function Sidebar({
  entries,
  current,
}: {
  entries: ViewEntry[];
  current: string;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} width={22}>
      <Text bold>Views</Text>
      {entries.map((e) => (
        <Text key={e.key} color={e.key === current ? 'cyan' : undefined}>
          {e.key === current ? '▸ ' : '  '}
          {e.name}
        </Text>
      ))}
    </Box>
  );
}
```

`apps/tui/src/app.tsx`:

```tsx
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useState } from 'react';
import { ALL } from '@todoer/client-core';
import { useTui } from './context.js';
import { SCREENS, type Screen } from './screens.js';
import { Sidebar, viewEntries } from './sidebar.js';
import { StatusBar } from './status-bar.js';
import { useTopic, useView } from './topics.js';
import { Picker } from './ui/picker.js';
import { ViewPane } from './view-pane.js';

const HINTS =
  'j/k move · o new · x done · e details · m status · [ ] views · ? help · q quit';
const HELP = [
  'j k ↓ ↑   move           o O     new task / subtask',
  'h l ← →   fold / column  Enter i edit the line',
  'J K       move the task  x Space done / undo',
  'H L       board column   s       skip occurrence',
  'Tab S-Tab indent         m       status',
  'e         details        dd y    delete',
  'S         statuses       [ ] v   views',
  'r         sync now       q       quit',
];

export function App() {
  const { engine, topics, status } = useTui();
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const session = useTopic(topics, 'session');
  const catalog = useTopic(topics, 'catalog');
  const entries = viewEntries(catalog);
  const [key, setKey] = useState(ALL);
  const [screen, setScreen] = useState<Screen>({ kind: 'view' });
  const [picking, setPicking] = useState(false);
  const [help, setHelp] = useState(false);
  const view = useView(topics, key);

  // A deleted view falls back to All open.
  const known = entries.some((e) => e.key === key);
  useEffect(() => {
    if (catalog !== undefined && !known) setKey(ALL);
  }, [catalog, known]);

  useEffect(() => {
    void engine.handle(
      {
        kind: 'watch',
        view: key,
        task: screen.kind === 'details' ? screen.taskId : null,
      },
      'tui',
    );
  }, [engine, key, screen]);

  /** A screen whose plan has not landed yet says so instead of opening. */
  const openScreen = (next: Screen) => {
    if (
      (next.kind === 'details' && SCREENS.details === undefined) ||
      (next.kind === 'statuses' && SCREENS.statuses === undefined)
    ) {
      status.say({ tone: 'info', text: `${next.kind} is not built yet` });
      return;
    }
    setScreen(next);
  };

  const onView = screen.kind === 'view' && !picking && !help;
  useInput(
    (input) => {
      const i = entries.findIndex((e) => e.key === key);
      const step = (d: number) => {
        const next = entries[(i + d + entries.length) % entries.length];
        if (next !== undefined) setKey(next.key);
      };
      if (input === 'q') exit();
      else if (input === ']') step(1);
      else if (input === '[') step(-1);
      else if (input === 'v') setPicking(true);
      else if (input === '?') setHelp(true);
      else if (input === 'r') void engine.handle({ kind: 'sync', reason: 'manual' }, 'tui');
      else if (input === 'S') openScreen({ kind: 'statuses' });
    },
    { isActive: onView },
  );
  useInput(() => setHelp(false), { isActive: help });

  if (session?.state === 'signed-out') {
    return (
      <Box flexDirection="column">
        <Text>Not signed in. Run `todoer login`, then start todoer-tui again.</Text>
        <Text dimColor>q quit</Text>
        <QuitOnQ />
      </Box>
    );
  }

  const close = () => setScreen({ kind: 'view' });
  const body =
    screen.kind === 'details' && SCREENS.details !== undefined
      ? SCREENS.details({ taskId: screen.taskId, close })
      : screen.kind === 'statuses' && SCREENS.statuses !== undefined
        ? SCREENS.statuses({ close })
        : null;

  return (
    <Box flexDirection="column">
      <Box>
        {columns >= 80 ? <Sidebar entries={entries} current={key} /> : null}
        <Box flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1}>
          {help ? (
            HELP.map((line) => <Text key={line}>{line}</Text>)
          ) : picking ? (
            <Picker
              title="View"
              items={entries.map((e) => ({ id: e.key, label: e.name }))}
              initial={key}
              onPick={(id) => {
                setKey(id);
                setPicking(false);
              }}
              onCancel={() => setPicking(false)}
            />
          ) : body !== null ? (
            body
          ) : view === undefined ? (
            <Text dimColor>loading…</Text>
          ) : (
            <ViewPane view={view} active={onView} open={openScreen} />
          )}
        </Box>
      </Box>
      <StatusBar hints={HINTS} />
    </Box>
  );
}

function QuitOnQ() {
  const { exit } = useApp();
  useInput((input) => input === 'q' && exit());
  return null;
}
```

Hooks are all called above the signed-out early return, as React requires;
keep any hook a later edit adds above it too.

- [ ] **Step 4: Run the app test**

Run: `pnpm --filter @todoer/tui exec vitest run src/app.spec.tsx`
Expected: PASS. If a frame is read before the engine published, raise the
kit's `settle` delay rather than adding sleeps to the test.

- [ ] **Step 5: `main.tsx`**

`apps/tui/src/main.tsx`:

```tsx
#!/usr/bin/env node
import { render } from 'ink';
import { uuidv7 } from 'uuidv7';
import {
  createEngine,
  httpAuthApi,
  httpTransport,
  localDate,
  tokenSource,
} from '@todoer/client-core';
import { openReplica, readConfig } from '@todoer/client-core/node-sqlite';
import { App } from './app.js';
import { TuiContext } from './context.js';
import { cliSession } from './session.js';
import { createStatusLine } from './status-line.js';
import { createTopics } from './topics.js';

/** The cadence (design, Routine choices): a tick every 30 s. */
const TICK_MS = 30_000;

async function main(): Promise<number> {
  const config = readConfig(process.env);
  const store = openReplica(config.dbPath);
  try {
    const now = () => new Date();
    const api = httpAuthApi(config);
    // The CLI's wiring: the transport may use TODOER_TOKEN, the session is
    // the stored one (index.ts in apps/cli).
    const send = httpTransport(config, tokenSource(store, api, config.token, now));
    const { auth, tokens } = cliSession(
      store,
      tokenSource(store, api, config.token, now),
      config.token,
    );
    const topics = createTopics();
    const engine = createEngine({
      store,
      auth,
      tokens,
      send,
      now,
      newId: uuidv7,
      publish: (topic, value) => topics.publish(topic, value),
    });
    const tui = {
      engine,
      topics,
      newId: uuidv7,
      today: () => localDate(now()),
      status: createStatusLine(),
    };
    const app = render(
      <TuiContext.Provider value={tui}>
        <App />
      </TuiContext.Provider>,
      { alternateScreen: true, exitOnCtrlC: true },
    );
    void engine.start(tokens.signedIn());
    const timer = setInterval(
      () => void engine.handle({ kind: 'sync', reason: 'tick' }, 'tui'),
      TICK_MS,
    );
    try {
      await app.waitUntilExit();
    } finally {
      clearInterval(timer);
    }
    return 0;
  } finally {
    store.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // An unexpected local failure, as for the CLI: Ink has restored the
    // terminal by the time this runs.
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 3;
  },
);
```

Why a tick needs no visibility check: a terminal has none. A tick during a
sync is dropped by the engine (single-flight).

Note: a write's own sync happens inside the core operation (`submit` sends
at once), so "after every write" needs nothing here.

- [ ] **Step 6: Build and run it by hand**

Run: `pnpm -w exec turbo run build --filter=@todoer/tui...`
Then, with a backend running (`docker compose -f docker/compose.yml --profile app up -d` or `pnpm --filter @todoer/backend start`) and `todoer login` done:
`node apps/tui/dist/main.js`
Expected: views on the left, tasks on the right, `synced` in the status bar;
`o` adds, `x` completes, `q` quits; `todoer list` in another shell shows the
change. Record anything surprising in the task spec.

- [ ] **Step 7: Commit**

```bash
git add apps/tui
git commit -m "feat(tui): render views and tasks with sync and a flat list"
```

---

### Task 5: Documents and the pull request

- [ ] **Step 1: README**

`apps/tui/README.md`:

````md
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
````

- [ ] **Step 2: CLAUDE.md and the design doc**

`.claude/CLAUDE.md`, "The stack": "Five packages and the image" → "Six
packages and the image"; add a row after `apps/cli`:

```md
| `apps/tui` | The terminal client (Ink). Shares the CLI's replica and session; runs the core engine. |
```

and in the `packages/client-core` row, mention that `./node-sqlite` also
holds `openReplica` and `readConfig`, shared by the CLI and the TUI.

Run: `pnpm exec prettier --check .claude docs apps/tui`
Expected: clean.

- [ ] **Step 3: Gates**

Run: `pnpm -w exec turbo run build typecheck test --filter='!@todoer/backend' && pnpm lint`
Expected: green. (The backend's DB tests are covered by CI; another lane may
be using the local `todoer_test` database.)

- [ ] **Step 4: Close the task spec, changelog, PR**

Tick steps and DoD, `Status: done`, `Completed`, `Result`; `git add`, then
`git mv specs/tasks/active/T-2026-10-03-tui-shell.md specs/tasks/done/`.

Run: `dnote add todoer -c "2026-10-03 · todoer-tui starts: views, a task list, quick add, done and delete, on the CLI's replica and session with the core engine."`

```bash
git add -A
git commit -m "docs: document the terminal client's shell"
git push -u origin feat/tui-shell
gh pr create --title "feat(tui): start the terminal client" --body "…"
```
