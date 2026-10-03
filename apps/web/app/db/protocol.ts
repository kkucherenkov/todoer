import type { FromWorker } from '@todoer/client-core';

/** The browser transport's names. The messages themselves are the core's
 *  `ToWorker` and `FromWorker`. */
export const CHANNEL = 'todoer';
export const LEADER_LOCK = 'todoer:leader';
/** Held by one leader for as long as it leads: a tab hears a leader's
 *  messages only while this is held (client.ts). */
export const leaderLock = (leader: string) => `${LEADER_LOCK}:${leader}`;

/** What a tab hears: every message names the leader that sent it. */
export type FromLeader = FromWorker & { leader: string };

/** Leader tab → its dedicated worker, over postMessage, once. */
export type Init = {
  type: 'init';
  build: string;
  leader: string;
  hint: boolean;
};
/** Worker → leader tab, over postMessage: init failed. */
export type Fatal = { type: 'fatal'; reason: string };
