import { createContext, useContext } from 'react';
import type { Tui } from './tui.js';

export type { Tui };

export const TuiContext = createContext<Tui | null>(null);

export function useTui(): Tui {
  const tui = useContext(TuiContext);
  if (tui === null) throw new Error('useTui outside TuiContext');
  return tui;
}
