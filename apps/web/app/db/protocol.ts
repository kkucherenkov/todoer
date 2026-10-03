/** The browser transport's names. The messages themselves are the core's
 *  `ToWorker` and `FromWorker`. */
export const CHANNEL = 'todoer';
export const LEADER_LOCK = 'todoer:leader';

/** Leader tab → its dedicated worker, over postMessage, once. */
export type Init = { type: 'init'; build: string; hint: boolean };
/** Worker → leader tab, over postMessage: init failed. */
export type Fatal = { type: 'fatal'; reason: string };
