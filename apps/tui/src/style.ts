export const sgr = (code: number, text: string) =>
  `\u001b[${code}m${text}\u001b[0m`;

/** `NO_COLOR` gives monochrome; bold and dim stay, colour goes. */
export const colour = () => (process.env.NO_COLOR ?? '') === '';
