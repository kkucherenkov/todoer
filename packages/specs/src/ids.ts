import { createHash } from 'node:crypto';

/**
 * The namespace every deterministic id is derived in. Frozen protocol: a
 * different value orphans every task occurrence and TaskTag row on every
 * replica (plan C design, Q7).
 */
export const ID_NAMESPACE = '40e49f07-6ce6-46fc-b2de-65dd46253bf2';

/**
 * RFC 9562 UUIDv5: SHA-1 over the namespace's 16 bytes and the name's UTF-8.
 *
 * ponytail: node:crypto, so Node only. The web client needs a SHA-1 that runs
 * in a browser (crypto.subtle is async); swap the hash when it arrives.
 */
export function uuidv5(name: string, namespace: string = ID_NAMESPACE): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/** A task occurrence's id: `<task_id>:<YYYY-MM-DD>`, or `<task_id>:` when null. */
export function taskOccurrenceId(
  taskId: string,
  occurrence: string | null,
): string {
  return uuidv5(`${taskId.toLowerCase()}:${occurrence ?? ''}`);
}

/** A TaskTag row's id: `<task_id>:<tag_id>`. */
export function taskTagId(taskId: string, tagId: string): string {
  return uuidv5(`${taskId.toLowerCase()}:${tagId.toLowerCase()}`);
}
