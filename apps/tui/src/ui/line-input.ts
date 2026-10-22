import { Input } from '@earendil-works/pi-tui';
import { setInputValue } from '../pi/adapter.js';

/** One editable line, focused, with the cursor after `initial`: Enter
 *  submits, Esc cancels. An empty label is no prompt. */
export function lineInput({
  label,
  initial = '',
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}): Input {
  const input = new Input({ prompt: label === '' ? '' : `${label} ` });
  input.focused = true;
  if (initial !== '') setInputValue(input, initial);
  input.onSubmit = onSubmit;
  input.onEscape = onCancel;
  return input;
}
