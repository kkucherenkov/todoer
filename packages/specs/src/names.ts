/**
 * The form in which two tag or project names are compared (quick-add
 * design, Q4): NFC, so a composed and a decomposed `é` agree, then lower
 * case, so `@Phone` and `@phone` are one tag. The stored spelling is never
 * changed. Every client compares names through this, or they disagree
 * about which rows are duplicates.
 */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}
