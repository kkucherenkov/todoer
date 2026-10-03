import type { Topics } from '@todoer/client-core';
import { DetailsScreen } from './details.js';
import { StatusesScreen } from './statuses.js';

export type Screen =
  { kind: 'view' } | { kind: 'details'; taskId: string } | { kind: 'statuses' };

/** What every pane gets: the view it shows, whether keys are its, and a way
 *  to open another screen. */
export type PaneProps = {
  view: Topics['view'];
  active: boolean;
  open: (screen: Screen) => void;
};

/** The screens a feature plan provides; `undefined` until it lands. */
export const SCREENS = { details: DetailsScreen, statuses: StatusesScreen };
