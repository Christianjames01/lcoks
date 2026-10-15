// Letter avatars for logins: a badge in the site's colour, worked out offline
// from the item's website / platform / service name or title. No icons are
// downloaded.

export interface SiteBadge {
  /** 1–3 characters shown on the badge. */
  text: string;
  background: string;
  color: string;
  /** Recognised brand name, if any. */
  brand?: string;
}

// [match, brand, badge text, background]. Matched against the website's host
// and the item's names, so "facebook.com", "FB" and "Facebook (old)" all work.
const BRANDS: [RegExp, string, string, string][] = [
  [/\bfacebook\b|\bfb\.com\b|\bfb\b/, 'Facebook', 'f', '#1877F2'],
  [/\bmessenger\b/, 'Messenger', 'm', '#0084FF'],
  [/\binstagram\b|\big\b/, 'Instagram', 'IG', 'linear-gradient(45deg, #F58529, #DD2A7B 55%, #8134AF)'],
  [/\btiktok\b/, 'TikTok', 'T', '#010101'],
  [/\btwitter\b|\bx\.com\b/, 'X', 'X', '#000000'],
  [/\bthreads\b/, 'Threads', '@', '#000000'],
  [/\byoutube\b/, 'YouTube', 'YT', '#FF0000'],
  [/\bgmail\b/, 'Gmail', 'M', '#EA4335'],
  [/\bgoogle\b/, 'Google', 'G', '#4285F4'],
  [/\boutlook\b|\bhotmail\b|\blive\.com\b/, 'Outlook', 'O', '#0078D4'],
  [/\bmicrosoft\b|\bxbox\b/, 'Microsoft', 'MS', '#107C10'],
  [/\byahoo\b/, 'Yahoo', 'Y!', '#6001D2'],
  [/\bicloud\b|\bapple\b/, 'Apple', 'iC', '#1D1D1F'],
  [/\bgithub\b/, 'GitHub', 'GH', '#24292F'],
  [/\bgitlab\b/, 'GitLab', 'GL', '#FC6D26'],
  [/\blinkedin\b/, 'LinkedIn', 'in', '#0A66C2'],
  [/\bnetflix\b/, 'Netflix', 'N', '#E50914'],
  [/\bspotify\b/, 'Spotify', 'S', '#1DB954'],
  [/\bdisney\b/, 'Disney+', 'D+', '#113CCF'],
  [/\bprime video\b|\bamazon\b/, 'Amazon', 'a', '#FF9900'],
  [/\bviu\b/, 'Viu', 'V', '#F6BE00'],
  [/\bshopee\b/, 'Shopee', 'S', '#EE4D2D'],
  [/\blazada\b/, 'Lazada', 'Lz', '#0F146D'],
  [/\btemu\b/, 'Temu', 'T', '#FB7701'],
  [/\bshein\b/, 'SHEIN', 'S', '#000000'],
  [/\bfoodpanda\b/, 'foodpanda', 'fp', '#D70F64'],
  [/\bgrab\b/, 'Grab', 'G', '#00B14F'],
  [/\bpaypal\b/, 'PayPal', 'P', '#003087'],
  [/\bsteam\b/, 'Steam', 'St', '#171A21'],
  [/\bepic games\b|\bepicgames\b|\bfortnite\b/, 'Epic Games', 'E', '#313131'],
  [/\briot\b|\bvalorant\b|\bleague of legends\b/, 'Riot Games', 'R', '#EB0029'],
  [/\bmobile legends\b|\bmlbb\b|\bmoonton\b/, 'Mobile Legends', 'ML', '#1B2A4A'],
  [/\broblox\b/, 'Roblox', 'R', '#000000'],
  [/\bplaystation\b|\bpsn\b/, 'PlayStation', 'PS', '#003791'],
  [/\bnintendo\b/, 'Nintendo', 'N', '#E60012'],
  [/\bgenshin\b|\bhoyoverse\b|\bmihoyo\b/, 'HoYoverse', 'H', '#2E3A59'],
  [/\bdiscord\b/, 'Discord', 'D', '#5865F2'],
  [/\btelegram\b/, 'Telegram', 'T', '#26A5E4'],
  [/\bwhatsapp\b/, 'WhatsApp', 'W', '#25D366'],
  [/\bviber\b/, 'Viber', 'V', '#7360F2'],
  [/\bsnapchat\b/, 'Snapchat', 'S', '#FFFC00'],
  [/\breddit\b/, 'Reddit', 'r', '#FF4500'],
  [/\bpinterest\b/, 'Pinterest', 'P', '#E60023'],
  [/\btwitch\b/, 'Twitch', 'Tw', '#9146FF'],
  [/\bdropbox\b/, 'Dropbox', 'Db', '#0061FF'],
  [/\bnotion\b/, 'Notion', 'N', '#000000'],
  [/\bcanva\b/, 'Canva', 'C', '#00C4CC'],
  [/\bfigma\b/, 'Figma', 'F', '#F24E1E'],
  [/\badobe\b/, 'Adobe', 'A', '#FA0F00'],
  [/\bzoom\b/, 'Zoom', 'Z', '#2D8CFF'],
  [/\bslack\b/, 'Slack', 'S', '#4A154B'],
  [/\bchatgpt\b|\bopenai\b/, 'ChatGPT', 'AI', '#10A37F'],
  [/\bclaude\b|\banthropic\b/, 'Claude', 'C', '#D97757'],
  [/\bcanvas\b|\binstructure\b/, 'Canvas', 'C', '#E72429'],
  [/\bwordpress\b/, 'WordPress', 'W', '#21759B']
];

// Muted, readable colours for sites we do not know.
const FALLBACK = ['#5E5CE6', '#0A84FF', '#30B0C7', '#34A853', '#FF9F0A', '#FF6482', '#AF52DE', '#8E8E93', '#A2845E', '#E8590C'];

/** Host part of a URL or bare domain ("https://www.shopee.ph/x" → "shopee.ph"). */
export function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url.trim()}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** "accounts.shopee.ph" → "Shopee". */
function nameFromHost(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length === 0) return '';
  // Skip country second-level domains such as .com.ph / .co.uk.
  let i = parts.length >= 2 ? parts.length - 2 : 0;
  if (i > 0 && /^(com|co|net|org|gov|edu|ac)$/.test(parts[i]!)) i--;
  const label = parts[i]!;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Black or white text, whichever reads better on the colour. */
function textOn(background: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(background);
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // White on brand colours, as the brands do; dark text only where white would be hard to read
  // (badge letters are large and bold, so 3:1 is enough).
  return 1.05 / (L + 0.05) >= 3 ? '#FFFFFF' : '#111111';
}

/**
 * Badge for a login. `names` are the item's website, platform/service and title,
 * most specific first. Returns null when there is nothing to go on.
 */
export function siteBadge(website: string | undefined, names: (string | undefined)[]): SiteBadge | null {
  const host = hostOf(website);
  const clean = names.map((n) => (n ?? '').trim()).filter(Boolean);
  const haystack = ` ${[host, ...clean].join(' ').toLowerCase()} `;
  for (const [re, brand, text, background] of BRANDS) {
    if (re.test(haystack)) return { text, background, color: textOn(background), brand };
  }
  const name = clean[0] || nameFromHost(host);
  const letter = [...name].find((c) => /[\p{L}\p{N}]/u.test(c));
  if (!letter) return null;
  const background = FALLBACK[hash(name.toLowerCase()) % FALLBACK.length]!;
  return { text: letter.toUpperCase(), background, color: textOn(background) };
}
