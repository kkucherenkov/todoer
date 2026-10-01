/**
 * Why a new password is refused, or `null` (plan D design, Q14): at least 8
 * characters with a letter, a digit and a symbol. One check for register,
 * reset and change, so no path is a way around it. Existing passwords are
 * never re-checked.
 */
export function passwordProblem(password: string): string | null {
  const missing: string[] = [];
  if ([...password].length < 8) return 'a password needs at least 8 characters';
  if (!/\p{L}/u.test(password)) missing.push('a letter');
  if (!/\p{N}/u.test(password)) missing.push('a digit');
  if (!/[^\p{L}\p{N}]/u.test(password)) missing.push('a symbol');
  return missing.length === 0 ? null : `a password needs ${missing.join(', ')}`;
}
