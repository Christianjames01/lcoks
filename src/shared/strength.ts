// Password strength estimator (offline, dependency-free).
//
// This is a heuristic: it estimates guessing entropy from the character pool and
// then subtracts for common, well-known weaknesses (common passwords, keyboard
// walks, sequences, repeats, dates, dictionary-like structure). It deliberately
// errs on the side of rating passwords as weaker.

export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export interface StrengthResult {
  score: StrengthScore;
  label: 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  bits: number;
  feedback: string[];
}

const LABELS: StrengthResult['label'][] = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

// Small list of the most common passwords / base words (lowercase).
const COMMON = new Set([
  'password', 'passw0rd', 'p@ssword', 'p@ssw0rd', '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'qwertyuiop', 'abc123', 'letmein', 'welcome', 'admin', 'administrator', 'iloveyou',
  'monkey', 'dragon', 'football', 'baseball', 'master', 'sunshine', 'princess', 'shadow',
  'superman', 'batman', 'trustno1', 'login', 'starwars', 'whatever', 'freedom', 'secret',
  'hello', 'charlie', 'michael', 'jessica', 'pokemon', 'computer', 'internet', 'samsung',
  'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm', '111111', '000000', '121212', '654321',
  'changeme', 'default', 'guest', 'root', 'toor', 'test', 'vault', 'pass', 'access', 'love',
  'summer', 'winter', 'spring', 'autumn', 'google', 'facebook', 'apple', 'microsoft', 'mustang'
]);

const SEQUENCES = [
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  '1qaz2wsx3edc',
  'qazwsxedc'
];

function poolSize(pw: string): number {
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9\s]/.test(pw)) pool += 33;
  if (/\s/.test(pw)) pool += 1;
  // Non-ASCII (Unicode) characters enlarge the search space considerably.
  if (/[^\x00-\x7F]/.test(pw)) pool += 100;
  return Math.max(pool, 1);
}

function hasSequence(lower: string, minLen = 4): boolean {
  for (const seq of SEQUENCES) {
    const rev = [...seq].reverse().join('');
    for (let i = 0; i + minLen <= seq.length; i++) {
      if (lower.includes(seq.slice(i, i + minLen)) || lower.includes(rev.slice(i, i + minLen))) return true;
    }
  }
  return false;
}

/** De-leet a string for dictionary comparison. */
function unleet(s: string): string {
  return s
    .replace(/[@4]/g, 'a')
    .replace(/3/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/7/g, 't');
}

export function estimateStrength(password: string): StrengthResult {
  const feedback: string[] = [];
  const chars = [...password]; // count Unicode code points, not UTF-16 units
  const length = chars.length;
  if (length === 0) return { score: 0, label: LABELS[0], bits: 0, feedback: ['Enter a password.'] };

  // Effective length: collapse runs of the same character.
  let effective = 0;
  let prev = '';
  let run = 0;
  for (const c of chars) {
    if (c === prev) {
      run++;
      effective += run > 2 ? 0.1 : 0.5;
    } else {
      run = 1;
      effective += 1;
    }
    prev = c;
  }
  const uniqueRatio = new Set(chars).size / length;
  let bits = effective * Math.log2(poolSize(password));
  if (uniqueRatio < 0.5) bits *= 0.75;

  const lower = password.toLowerCase();
  const stripped = unleet(lower).replace(/[^a-z]/g, '');

  if (COMMON.has(lower) || COMMON.has(unleet(lower))) {
    bits = Math.min(bits, 8);
    feedback.push('This is a very common password.');
  } else if ([...COMMON].some((w) => w.length >= 5 && stripped.includes(w))) {
    bits -= 18;
    feedback.push('Avoid common words and passwords.');
  }
  if (hasSequence(lower)) {
    bits -= 12;
    feedback.push('Avoid sequences like "abcd" or "1234".');
  }
  if (/(19|20)\d{2}/.test(password)) {
    bits -= 6;
    feedback.push('Avoid years and dates.');
  }
  if (/^[A-Z]?[a-z]+\d{0,4}[!@#$%^&*?.]?$/.test(password)) {
    // "Word123!" pattern
    bits -= 10;
    feedback.push('A capitalized word plus numbers is easy to guess.');
  }
  if (length < 12) feedback.push('Use at least 12 characters (16+ recommended).');

  bits = Math.max(0, Math.round(bits));
  let score: StrengthScore;
  if (bits < 28) score = 0;
  else if (bits < 45) score = 1;
  else if (bits < 60) score = 2;
  else if (bits < 80) score = 3;
  else score = 4;
  if (length < 8 && score > 1) score = 1;

  if (score >= 3 && feedback.length === 0) feedback.push('Good password.');
  return { score, label: LABELS[score], bits, feedback };
}
