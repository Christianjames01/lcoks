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
  /** 1–4 character badge text for small icons. */
  short: string;
}

// Approximate brand colours of common Philippine banks, e-wallets, government
// IDs, insurers and subscription services. Only the NAME is shown as text — no
// logos or card artwork are reproduced.
const THEMES: [RegExp, Omit<CardTheme, 'label' | 'short'>, string][] = [
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
  [/paypal/i, { background: 'linear-gradient(135deg, #003087 0%, #001c4f 100%)', color: '#fff' }, 'PayPal'],
  [/shopee ?pay|\bshopee\b/i, { background: 'linear-gradient(135deg, #ee4d2d 0%, #a8321b 100%)', color: '#fff' }, "ShopeePay"],
  [/grab ?pay|\bgrab\b/i, { background: 'linear-gradient(135deg, #00b14f 0%, #006b30 100%)', color: '#fff' }, "GrabPay"],
  [/coins\.?ph/i, { background: 'linear-gradient(135deg, #1c4dd6 0%, #0d2a80 100%)', color: '#fff' }, "Coins.ph"],
  [/philsys|national id|\bpsn\b|ephil ?id/i, { background: 'linear-gradient(135deg, #2f4f8f 0%, #14264d 100%)', color: '#fff' }, "PhilSys ID"],
  [/\bsss\b|social security/i, { background: 'linear-gradient(135deg, #0b4ea2 0%, #06295a 100%)', color: '#fff' }, "SSS"],
  [/phil ?health/i, { background: 'linear-gradient(135deg, #0f8a4b 0%, #06522b 100%)', color: '#fff' }, "PhilHealth"],
  [/pag-?ibig|\bhdmf\b/i, { background: 'linear-gradient(135deg, #0d6fb8 0%, #063e69 100%)', color: '#fff' }, "Pag-IBIG"],
  [/\btin\b|\bbir\b/i, { background: 'linear-gradient(135deg, #21366b 0%, #0f1b3a 100%)', color: '#fff' }, "BIR · TIN"],
  [/\bumid\b|\bcrn\b/i, { background: 'linear-gradient(135deg, #4a4a4a 0%, #1c1c1c 100%)', color: '#fff' }, "UMID"],
  [/passport/i, { background: 'linear-gradient(135deg, #6b1426 0%, #360810 100%)', color: '#e9c46a' }, "Passport"],
  [/driver'?s? ?licen[cs]e|\blto\b/i, { background: 'linear-gradient(135deg, #1f6f8b 0%, #0c3949 100%)', color: '#fff' }, "Driver's License"],
  [/\bprc\b|professional regulation/i, { background: 'linear-gradient(135deg, #1b2a5c 0%, #0b1330 100%)', color: '#e9c46a' }, "PRC License"],
  [/postal id/i, { background: 'linear-gradient(135deg, #a11d2b 0%, #5c0f18 100%)', color: '#fff' }, "Postal ID"],
  [/voter'?s? id|comelec/i, { background: 'linear-gradient(135deg, #5b3a8c 0%, #2d1c47 100%)', color: '#fff' }, "Voter's ID"],
  [/maxicare/i, { background: 'linear-gradient(135deg, #0057a8 0%, #002d59 100%)', color: '#fff' }, "Maxicare"],
  [/intellicare/i, { background: 'linear-gradient(135deg, #f28c28 0%, #9c4f0b 100%)', color: '#fff' }, "Intellicare"],
  [/medicard/i, { background: 'linear-gradient(135deg, #00843d 0%, #004a22 100%)', color: '#fff' }, "MediCard"],
  [/philcare/i, { background: 'linear-gradient(135deg, #00a3a1 0%, #00595a 100%)', color: '#fff' }, "PhilCare"],
  [/sun ?life/i, { background: 'linear-gradient(135deg, #ffcb05 0%, #c79a00 100%)', color: '#1a1a1a' }, "Sun Life"],
  [/\baxa\b/i, { background: 'linear-gradient(135deg, #00008f 0%, #00004d 100%)', color: '#fff' }, "AXA"],
  [/pru ?life|prudential/i, { background: 'linear-gradient(135deg, #ed1b2e 0%, #8c0d19 100%)', color: '#fff' }, "Pru Life UK"],
  [/manulife/i, { background: 'linear-gradient(135deg, #00a758 0%, #005c30 100%)', color: '#fff' }, "Manulife"],
  [/\bfwd\b/i, { background: 'linear-gradient(135deg, #e87722 0%, #8a420e 100%)', color: '#fff' }, "FWD"],
  [/insular/i, { background: 'linear-gradient(135deg, #00539b 0%, #002a50 100%)', color: '#fff' }, "Insular Life"],
  [/netflix/i, { background: 'linear-gradient(135deg, #141414 0%, #000000 100%)', color: '#e50914' }, "NETFLIX"],
  [/spotify/i, { background: 'linear-gradient(135deg, #191414 0%, #000000 100%)', color: '#1db954' }, "Spotify"],
  [/youtube/i, { background: 'linear-gradient(135deg, #ff0000 0%, #9e0000 100%)', color: '#fff' }, "YouTube Premium"],
  [/disney/i, { background: 'linear-gradient(135deg, #0b2a6f 0%, #040f2e 100%)', color: '#fff' }, "Disney+"],
  [/prime video|amazon prime/i, { background: 'linear-gradient(135deg, #00a8e1 0%, #005c7c 100%)', color: '#fff' }, "Prime Video"],
  [/\bhbo\b|\bmax\b/i, { background: 'linear-gradient(135deg, #5822b4 0%, #250d4f 100%)', color: '#fff' }, "HBO Max"],
  [/\bviu\b/i, { background: 'linear-gradient(135deg, #ffbf00 0%, #b38600 100%)', color: '#1a1a1a' }, "Viu"],
  [/icloud|apple (music|one|tv)/i, { background: 'linear-gradient(135deg, #8e8e93 0%, #3a3a3c 100%)', color: '#fff' }, "Apple"],
  [/google one|google drive/i, { background: 'linear-gradient(135deg, #4285f4 0%, #1a56c4 100%)', color: '#fff' }, "Google One"],
  [/canva/i, { background: 'linear-gradient(135deg, #00c4cc 0%, #7d2ae8 100%)', color: '#fff' }, "Canva"],
  [/chatgpt|openai/i, { background: 'linear-gradient(135deg, #10a37f 0%, #0a5c48 100%)', color: '#fff' }, "ChatGPT"],
  [/crunchyroll/i, { background: 'linear-gradient(135deg, #f47521 0%, #9c4410 100%)', color: '#fff' }, "Crunchyroll"],
  [/game ?pass|\bxbox\b/i, { background: 'linear-gradient(135deg, #107c10 0%, #074707 100%)', color: '#fff' }, "Xbox Game Pass"],
  [/ps ?plus|playstation/i, { background: 'linear-gradient(135deg, #003791 0%, #001a45 100%)', color: '#fff' }, "PlayStation Plus"],
];

const DEFAULT_THEME: Omit<CardTheme, 'label' | 'short'> = {
  background: 'linear-gradient(135deg, #3a3a3a 0%, #121212 100%)',
  color: '#fff'
};

/** Pick a colour theme from the bank name (falls back to the item title). */
export function cardTheme(bankName: string | undefined, title: string): CardTheme {
  const hay = `${bankName ?? ''} ${title}`;
  for (const [re, theme, label] of THEMES) if (re.test(hay)) return { ...theme, label, short: SHORT[label] ?? label.slice(0, 4) };
  const label = (bankName || title).trim().slice(0, 24) || 'Card';
  return { ...DEFAULT_THEME, label, short: initials(label) };
}

const SHORT: Record<string, string> = {
  Metrobank: 'MB',
  LANDBANK: 'LBP',
  UnionBank: 'UB',
  'Security Bank': 'SB',
  Chinabank: 'CBC',
  EastWest: 'EW',
  GCash: 'G',
  maya: 'maya',
  SeaBank: 'Sea',
  GoTyme: 'GT',
  PSBank: 'PS',
  Tonik: 'T',
  PayPal: 'PP',
  "ShopeePay": "SP",
  "GrabPay": "GP",
  "Coins.ph": "C",
  "PhilSys ID": "PSA",
  "SSS": "SSS",
  "PhilHealth": "PH",
  "Pag-IBIG": "HDMF",
  "BIR · TIN": "TIN",
  "UMID": "UMID",
  "Passport": "PP",
  "Driver's License": "LTO",
  "PRC License": "PRC",
  "Postal ID": "PHL",
  "Voter's ID": "VID",
  "Maxicare": "MAX",
  "Intellicare": "IC",
  "MediCard": "MC",
  "PhilCare": "PC",
  "Sun Life": "SL",
  "AXA": "AXA",
  "Pru Life UK": "PRU",
  "Manulife": "MFC",
  "FWD": "FWD",
  "Insular Life": "IL",
  "NETFLIX": "N",
  "Spotify": "S",
  "YouTube Premium": "YT",
  "Disney+": "D+",
  "Prime Video": "PV",
  "HBO Max": "MAX",
  "Viu": "Viu",
  "Apple": "A",
  "Google One": "G1",
  "Canva": "C",
  "ChatGPT": "GPT",
  "Crunchyroll": "CR",
  "Xbox Game Pass": "XB",
  "PlayStation Plus": "PS",
};

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
