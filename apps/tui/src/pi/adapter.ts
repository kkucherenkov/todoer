import {
  Key,
  matchesKey,
  type Component,
  type Editor,
  type Input,
} from '@earendil-works/pi-tui';

/** `Input.setValue` clamps the cursor to where it was, and there is no
 *  `setCursor`: a value set on an empty line would be typed into at the
 *  start. Ctrl+E (end of line) puts the cursor after it. */
export function setInputValue(input: Input, value: string): void {
  input.setValue(value);
  // ponytail: synthesized Ctrl+E, ceiling is pi-tui 1.x having no setCursor; drop when it gains one
  input.handleInput('\x05');
}

/** `Editor` has no `onEscape` (`Input` does): Escape is caught before the
 *  editor sees it. */
export function withEscape(editor: Editor, onEscape: () => void): Component {
  return {
    render: (width) => editor.render(width),
    invalidate: () => editor.invalidate(),
    handleInput(data) {
      if (matchesKey(data, Key.escape)) onEscape();
      else editor.handleInput(data);
    },
  };
}
