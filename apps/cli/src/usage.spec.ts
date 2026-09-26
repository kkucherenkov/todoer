import { describe, expect, it } from 'vitest';
import { HELP, wantsHelp } from './usage.js';

describe('wantsHelp', () => {
  it('is a request for help when it is the command', () => {
    expect(wantsHelp(['--help'])).toBe(true);
    expect(wantsHelp(['-h'])).toBe(true);
  });

  // The regression this exists for: scanning the whole of argv meant any
  // title containing `-h` printed the help and exited 0, creating nothing.
  // A test that only passes `-h` first would pass either way.
  it('is not a request for help when -h is one of the words of a title', () => {
    expect(wantsHelp(['add', 'review', 'the', '-h', 'flag', 'docs'])).toBe(
      false,
    );
  });

  it('is not a request for help when --help is one of those words', () => {
    expect(wantsHelp(['add', 'document', 'the', '--help', 'output'])).toBe(
      false,
    );
  });

  it('is not a request for help when nothing was given', () => {
    expect(wantsHelp([])).toBe(false);
  });
});

describe('HELP', () => {
  // Telling a caller to branch on a code no command can produce is the same
  // class of untruth as a gate that checks nothing.
  it('marks the conflict code as reserved rather than as something to branch on', () => {
    expect(HELP).toMatch(/reserved/);
  });

  it('documents exit 5, the envelope, the outbox and the timeout', () => {
    expect(HELP).toMatch(/^\s+5 /m);
    expect(HELP).toMatch(/"synced"/);
    expect(HELP).toMatch(/todoer outbox drop/);
    expect(HELP).toMatch(/TODOER_TIMEOUT_MS/);
  });

  it('no longer tells callers that add is unsafe to retry', () => {
    expect(HELP).not.toMatch(/NOT safe to retry/);
  });
});
