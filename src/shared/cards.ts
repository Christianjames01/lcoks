// Bank-card helpers: card network detection and bank colour themes.
//
// SECURITY: detectCardNetwork() runs where the vault is decrypted (main process /
// mobile vault) and only its RESULT ("visa", "mastercard"…) is sent to the UI —
// the full card number never is.

export type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'jcb' | 'discover' | 'unionpay';

export function detectCardNetwork(cardNumber: string): CardNetwork | undefined {
  const n = cardNumber.replace(/\D/g, '');
  if (n.length < 4) return undefined;
  const p2 = Number(n.slice(0, 2));
  const p3 = Number(n.slice(0, 3));
  const p4 = Number(n.slice(0, 4));
  if (n.startsWith('4')) return 'visa';
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return 'mastercard';
  if (p2 === 34 || p2 === 37) return 'amex';
  if (p4 >= 3528 && p4 <= 3589) return 'jcb';
  if (p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649)) return 'discover';
  if (p2 === 62) return 'unionpay';
  return undefined;
}

/** Luhn checksum — used only to warn about typos in the form. */
export function luhnValid(cardNumber: string): boolean {
  const n = cardNumber.replace(/\D/g, '');
  if (n.length < 12 || n.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Accepts MM/YY or MM/YYYY. */
export function normalizeExpiry(value: string): string | null {
  const m = /^\s*(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})\s*$/.exec(value);
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  return `${String(month).padStart(2, '0')}/${m[2]!.slice(-2)}`;
}

export interface CardTheme {
  /** CSS background for the card face. */
  background: string;
  /** Text colour. */
  color: string;
  /** Short brand text shown on the card. */
  label: string;
}

// Approximate brand colours of common Philippine banks and e-wallets. Only the
// bank's NAME is shown as text — no logos or card artwork are reproduced.
const THEMES: [RegExp, Omit<CardTheme, 'label'>, string][] = [
  [/\bbpi\b|bank of the philippine islands/i, { background: 'linear-gradient(135deg, #c8102e 0%, #7d0a1c 100%)', color: '#fff' }, 'BPI'],
  [/\bbdo\b|banco de oro/i, { background: 'linear-gradient(135deg, #0a3d91 0%, #062561 100%)', color: '#fff' }, 'BDO'],
  [/metro ?bank/i, { background: 'linear-gradient(135deg, #0057b8 0%, #00306b 100%)', color: '#fff' }, 'Metrobank'],
  [/land ?bank/i, { background: 'linear-gradient(135deg, #008c45 0%, #00502a 100%)', color: '#fff' }, 'LANDBANK'],
  [/\bpnb\b|philippine national bank/i, { background: 'linear-gradient(135deg, #1b3f8b 0%, #0d2150 100%)', color: '#fff' }, 'PNB'],
  [/union ?bank/i, { background: 'linear-gradient(135deg, #f58025 0%, #b4520c 100%)', color: '#fff' }, 'UnionBank'],
  [/security ?bank/i, { background: 'linear-gradient(135deg, #00a1a7 0%, #00585c 100%)', color: '#fff' }, 'Security Bank'],
  [/\brcbc\b/i, { background: 'linear-gradient(135deg, #0047ab 0%, #00245c 100%)', color: '#fff' }, 'RCBC'],
  [/china ?bank/i, { background: 'linear-gradient(135deg, #d0103a 0%, #80061f 100%)', color: '#fff' }, 'Chinabank'],
  [/east ?west/i, { background: 'linear-gradient(135deg, #7b2c8f 0%, #44144f 100%)', color: '#fff' }, 'EastWest'],
  [/\bgcash\b/i, { background: 'linear-gradient(135deg, #0a7cff 0%, #0049a8 100%)', color: '#fff' }, 'GCash'],
  [/\bmaya\b|paymaya/i, { background: 'linear-gradient(135deg, #111 0%, #000 60%, #0a3d2a 100%)', color: '#3fe08a' }, 'maya'],
  [/sea ?bank/i, { background: 'linear-gradient(135deg, #ff6a2b 0%, #c23d07 100%)', color: '#fff' }, 'SeaBank'],
  [/go ?tyme/i, { background: 'linear-gradient(135deg, #2e2a6b 0%, #14123a 100%)', color: '#6fe3d0' }, 'GoTyme'],
  [/\bcimb\b/i, { background: 'linear-gradient(135deg, #d6001c 0%, #6e000e 100%)', color: '#fff' }, 'CIMB'],
  [/ps ?bank/i, { background: 'linear-gradient(135deg, #0e4c92 0%, #062a55 100%)', color: '#fff' }, 'PSBank'],
  [/\btonik\b/i, { background: 'linear-gradient(135deg, #7b3fe4 0%, #3d1689 100%)', color: '#fff' }, 'Tonik'],
  [/paypal/i, { background: 'linear-gradient(135deg, #003087 0%, #001c4f 100%)', color: '#fff' }, 'PayPal']
];

const DEFAULT_THEME: Omit<CardTheme, 'label'> = {
  background: 'linear-gradient(135deg, #3a3a3a 0%, #121212 100%)',
  color: '#fff'
};

/** Pick a colour theme from the bank name (falls back to the item title). */
export function cardTheme(bankName: string | undefined, title: string): CardTheme {
  const hay = `${bankName ?? ''} ${title}`;
  for (const [re, theme, label] of THEMES) if (re.test(hay)) return { ...theme, label };
  const label = (bankName || title).trim().slice(0, 24) || 'Card';
  return { ...DEFAULT_THEME, label };
}
