import { uuidv7 } from 'uuidv7';

/** Tab side: a new row's id, so the screen can open it before any reply. The
 *  write's op id comes from the same generator, in the core's `mint`. */
export const id = (): string => uuidv7();
