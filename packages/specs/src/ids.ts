/**
 * The namespace every deterministic id is derived in. Frozen protocol: a
 * different value orphans every task occurrence and TaskTag row on every
 * replica (plan C design, Q7).
 */
export const ID_NAMESPACE = '40e49f07-6ce6-46fc-b2de-65dd46253bf2';

/** FIPS 180-4 SHA-1: synchronous and portable, since `crypto.subtle` is async. */
export function sha1(bytes: Uint8Array): Uint8Array {
  const padded = new Uint8Array((((bytes.length + 8) >> 6) << 6) + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0);

  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    }
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6];
      const t = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  h.forEach((x, i) => outView.setUint32(i * 4, x >>> 0));
  return out;
}

const toBytes = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

/** RFC 9562 UUIDv5: SHA-1 over the namespace's 16 bytes and the name's UTF-8. */
export function uuidv5(name: string, namespace: string = ID_NAMESPACE): string {
  const ns = toBytes(namespace.replaceAll('-', ''));
  const nm = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nm.length);
  input.set(ns);
  input.set(nm, ns.length);
  const hash = sha1(input);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = Array.from(hash.subarray(0, 16), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
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
