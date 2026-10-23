import { describe, expect, it } from 'vitest';
import type { FromWorker } from '@todoer/client-core';
import { readEvents } from './stream';

const chunked = (...chunks: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );

const summary = (tasks: number) =>
  JSON.stringify({
    type: 'publish',
    topic: 'summary',
    value: { tasks },
    build: 'server',
  });

describe('readEvents', () => {
  it('splits events across chunk boundaries and ignores comments', async () => {
    const one = `data: ${summary(1)}\n\n`;
    const two = `data: ${summary(2)}\n\n`;
    const seen: FromWorker[] = [];
    await readEvents(
      chunked(
        one.slice(0, 7),
        one.slice(7) + ': ping\n\n' + two.slice(0, 20),
        two.slice(20, 21),
        two.slice(21),
      ),
      (event) => seen.push(event),
    );
    expect(seen.map((e) => e.type === 'publish' && e.value)).toEqual([
      { tasks: 1 },
      { tasks: 2 },
    ]);
  });

  it('keeps a multi-byte character split between chunks', async () => {
    const event = `data: ${JSON.stringify({
      type: 'publish',
      topic: 'summary',
      value: { title: 'Молоко' },
      build: 'server',
    })}\n\n`;
    const bytes = new TextEncoder().encode(event);
    const cut = bytes.indexOf(0xd0) + 1; // inside the first Cyrillic letter
    const seen: FromWorker[] = [];
    await readEvents(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(0, cut));
            controller.enqueue(bytes.slice(cut));
            controller.close();
          },
        }),
      ),
      (e) => seen.push(e),
    );
    expect(seen).toEqual([JSON.parse(event.slice(6))]);
  });
});
