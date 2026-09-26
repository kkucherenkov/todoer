#!/usr/bin/env node
import { uuidv7 } from 'uuidv7';
import { readConfig } from './config.js';
import { ConflictError, RefusalError, UsageError } from './protocol.js';
import { run } from './run.js';
import { Store } from './store.js';
import { httpTransport } from './transport.js';
import { HELP, wantsHelp } from './usage.js';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (wantsHelp(argv)) {
    console.log(HELP);
    return 0;
  }
  const config = readConfig(process.env);
  const store = Store.open(config.dbPath);
  try {
    const outcome = await run(argv, {
      store,
      send: httpTransport(config),
      now: () => new Date(),
      newId: uuidv7,
    });
    // stderr first, and stdout exactly one value under --json.
    for (const line of outcome.stderr) console.error(line);
    for (const line of outcome.stdout) console.log(line);
    return outcome.exit;
  } finally {
    store.close();
  }
}

// The one place an error class becomes an exit code; what each code means to
// a caller is in usage.ts's HELP.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      console.error(
        `${message}\nrun \`todoer --help\` for usage and exit codes`,
      );
      process.exitCode = 2;
    } else if (error instanceof RefusalError) {
      console.error(message);
      process.exitCode = 1;
    } else if (error instanceof ConflictError) {
      console.error(message);
      process.exitCode = 4;
    } else {
      // An unexpected local failure: the database busy past its timeout,
      // unreadable, or a bug. No network condition lands here any more.
      console.error(message);
      process.exitCode = 3;
    }
  },
);
