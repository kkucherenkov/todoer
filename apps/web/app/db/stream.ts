import type { FromWorker } from '@todoer/client-core';

/** Calls `on` for each `data:` event of a server-sent event stream until it
 *  ends. Comment lines (`: ping`) carry no data and are skipped. */
export async function readEvents(
  response: Response,
  on: (event: FromWorker) => void,
): Promise<void> {
  if (response.body === null) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const events = (buffer + value).split('\n\n');
    buffer = events.pop()!;
    for (const event of events) {
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
        .join('\n');
      if (data !== '') on(JSON.parse(data) as FromWorker);
    }
  }
}
