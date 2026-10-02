import { uuidv7 } from 'uuidv7';

/** Tab side (departure 2): a write's op id, minted once per user action. */
export const opId = (): string => uuidv7();
/** Tab side: a new row's id, so the screen can open it before any reply. */
export const id = (): string => uuidv7();
