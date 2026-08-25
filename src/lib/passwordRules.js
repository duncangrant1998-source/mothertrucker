// Mirrors the password rules configured on the Supabase project
// (Authentication > Sign In / Providers > Email): a 12 character minimum plus
// one of each character class.
//
// Advisory only. Supabase stays the authority, and nothing here blocks a
// submission: if these ever drift from the dashboard settings, a stale rule
// would lock people out of signing up rather than merely misinform them. Keep
// this in step with the dashboard if those settings change.

// The exact set Supabase accepts. A generic "non-alphanumeric" test would
// wrongly pass a space or an accented character as a symbol.
const SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";

export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_RULES = [
  {
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH
  },
  { label: 'A lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { label: 'An uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { label: 'A number', test: (pw) => /[0-9]/.test(pw) },
  { label: 'A symbol', test: (pw) => pw.split('').some((c) => SYMBOLS.includes(c)) }
];

// True when every rule passes. Not used to gate submission — see above.
export const meetsPasswordRules = (pw) => PASSWORD_RULES.every(({ test }) => test(pw));
