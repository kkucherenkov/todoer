/** The `one`/`few`/`many`/`other` form a locale uses for `n`. */
export const pluralForm = (locale: string, n: number) =>
  new Intl.PluralRules(locale).select(n);
