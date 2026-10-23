import { Injectable } from '@nestjs/common';

/**
 * Per-user, in-process announcements that a write committed. A listener
 * (a user's engine) is told only "something changed"; it pulls for the rest.
 * Single process by design: it does not reach a second backend instance.
 */
@Injectable()
export class ChangeFeed {
  private readonly listeners = new Map<string, Set<() => void>>();

  announce(userId: string): void {
    for (const fn of [...(this.listeners.get(userId) ?? [])]) fn();
  }

  listen(userId: string, fn: () => void): () => void {
    const set = this.listeners.get(userId) ?? new Set();
    this.listeners.set(userId, set.add(fn));
    return () => {
      set.delete(fn);
      if (set.size === 0 && this.listeners.get(userId) === set)
        this.listeners.delete(userId);
    };
  }
}
