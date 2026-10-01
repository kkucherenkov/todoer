type Input = NodeJS.ReadableStream & {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
};

/**
 * `TODOER_PASSWORD`, else a prompt on a terminal (typed characters are not
 * echoed), else all of a pipe's stdin minus one trailing newline.
 */
export async function readPassword(
  env: NodeJS.ProcessEnv,
  stdin: Input = process.stdin,
  stderr: { write(text: string): unknown } = process.stderr,
): Promise<string> {
  if (env.TODOER_PASSWORD !== undefined) return env.TODOER_PASSWORD;
  stdin.setEncoding('utf8');
  if (!stdin.isTTY || stdin.setRawMode === undefined) {
    let text = '';
    for await (const chunk of stdin) text += String(chunk);
    return text.replace(/\r?\n$/, '');
  }
  stderr.write('password: ');
  stdin.setRawMode(true);
  let password = '';
  let skip = 0;
  try {
    for await (const chunk of stdin) {
      for (const ch of String(chunk)) {
        if (skip > 0) {
          // The `[` and final byte of an escape sequence, e.g. an arrow key.
          skip -= 1;
          continue;
        }
        if (ch === '\x1b') {
          skip = 2;
          continue;
        }
        if (ch === '\r' || ch === '\n' || ch === '\x04') return password;
        if (ch === '\x03') {
          // process.exit skips the finally below.
          stdin.setRawMode(false);
          stderr.write('\n');
          process.exit(130);
        }
        password =
          ch === '\x7f' || ch === '\b'
            ? [...password].slice(0, -1).join('')
            : password + ch;
      }
    }
    return password;
  } finally {
    stdin.setRawMode(false);
    stderr.write('\n');
  }
}
