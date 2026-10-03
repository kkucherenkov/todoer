import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Runs `$EDITOR file` attached to the terminal; its exit status. The
 *  command may carry arguments (`code --wait`), so it goes through a shell;
 *  the file goes in as `$1`, never spliced into the command. */
const runEditor = (cmd: string, file: string): number =>
  spawnSync('sh', ['-c', `${cmd} "$1"`, 'sh', file], { stdio: 'inherit' })
    .status ?? 1;

/**
 * Edits `text` in `$VISUAL`, then `$EDITOR`, then `vi`, through a private
 * temp file. Null when the editor failed or left the text as it was. The
 * trailing newline editors add is dropped. Call it with Ink suspended.
 */
export function editText(
  text: string,
  env: NodeJS.ProcessEnv,
  run: (cmd: string, file: string) => number = runEditor,
): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'todoer-notes-'));
  const file = join(dir, 'notes.md');
  try {
    writeFileSync(file, text, { mode: 0o600 });
    const cmd = env.VISUAL || env.EDITOR || 'vi';
    if (run(cmd, file) !== 0) return null;
    const next = readFileSync(file, 'utf8').replace(/\n$/, '');
    return next === text ? null : next;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
