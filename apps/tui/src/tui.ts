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
