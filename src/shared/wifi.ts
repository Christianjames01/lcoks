// Wi-Fi networks: the text inside a "join this Wi-Fi" QR code. Phone cameras
// (iPhone and Android) read the WIFI: format and offer to join the network.

export const WIFI_CATEGORY = 'wifiNetwork';

export type WifiAuth = 'WPA' | 'WEP' | 'nopass';

/** The Security field's options mapped to the QR code's T: value. */
export function wifiAuth(security: string | undefined, hasPassword: boolean): WifiAuth {
  const s = (security ?? '').toLowerCase();
  if (/none|open/.test(s)) return 'nopass';
  if (/wep/.test(s)) return 'WEP';
  return hasPassword ? 'WPA' : 'nopass';
}

/** Backslash before the characters the WIFI: format reserves. */
const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');

export function wifiQrText(net: { ssid: string; password?: string; security?: string; hidden?: boolean }): string {
  const ssid = net.ssid.trim();
  if (!ssid) throw new Error('A Wi-Fi network needs a name.');
  const auth = wifiAuth(net.security, !!net.password);
  const parts = [`T:${auth}`, `S:${esc(ssid)}`];
  if (auth !== 'nopass') parts.push(`P:${esc(net.password ?? '')}`);
  if (net.hidden) parts.push('H:true');
  return `WIFI:${parts.join(';')};;`;
}

/**
 * Network details of an item: the Wi-Fi category, or an older Wi-Fi item that
 * was moved to Others (tagged "wifi", network name in Name).
 */
export function wifiOf(e: { categoryId: string; fields: Record<string, string>; tags: string[] }): { ssid: string; security?: string; hidden: boolean } | null {
  if (e.categoryId === WIFI_CATEGORY && e.fields.ssid?.trim()) {
    return { ssid: e.fields.ssid.trim(), security: e.fields.security, hidden: e.fields.hidden === 'Yes' };
  }
  if (e.categoryId === 'others' && e.tags.includes('wifi') && e.fields.name?.trim()) {
    const sec = /Wi-Fi security:\s*(.+)/i.exec(e.fields.notes ?? '')?.[1]?.trim();
    return { ssid: e.fields.name.trim(), ...(sec ? { security: sec } : {}), hidden: false };
  }
  return null;
}

/** Read a "join this Wi-Fi" QR code (WIFI:T:WPA;S:name;P:pass;H:true;;), e.g. from a router sticker. */
export function parseWifiQr(text: string): { ssid: string; password: string; security: string; hidden: boolean } | null {
  const t = text.trim();
  if (!/^WIFI:/i.test(t)) return null;
  const fields: Record<string, string> = {};
  let key = '';
  let val = '';
  let inKey = true;
  for (let i = 5; i < t.length; i++) {
    const c = t[i]!;
    if (c === '\\' && i + 1 < t.length) {
      if (inKey) key += t[++i];
      else val += t[++i];
    } else if (inKey && c === ':') inKey = false;
    else if (!inKey && c === ';') {
      if (key) fields[key.toUpperCase()] = val;
      key = val = '';
      inKey = true;
    } else if (inKey) key += c;
    else val += c;
  }
  if (!inKey && key) fields[key.toUpperCase()] = val;
  const ssid = fields.S ?? '';
  if (!ssid) return null;
  const type = (fields.T ?? '').toUpperCase();
  return {
    ssid,
    password: fields.P ?? '',
    security: type === 'WEP' ? 'WEP' : type === 'NOPASS' || (!type && !fields.P) ? 'None (open)' : 'WPA / WPA2 / WPA3',
    hidden: /^true$/i.test(fields.H ?? '')
  };
}
