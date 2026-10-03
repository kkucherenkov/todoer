/** A destructive key asks once on the status line; only `y` confirms. */
export const confirmKeys = (input: string): 'yes' | 'no' =>
  input === 'y' ? 'yes' : 'no';
