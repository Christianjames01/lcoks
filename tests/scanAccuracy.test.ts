// Scan accuracy: router QR codes, sticker layouts and picking the right name on cards.

import { describe, expect, it } from 'vitest';
import { parseScan, parseScanQr } from '../src/shared/scan';
import { parseWifiQr, wifiQrText } from '../src/shared/wifi';

describe('Wi-Fi QR codes', () => {
  it('reads the WIFI: format, escapes and any field order', () => {
    expect(parseWifiQr(String.raw`WIFI:S:PLDTHOMEFIBR_a1b2;T:WPA;P:pa\;ss\:wd;H:false;;`)).toEqual({ ssid: 'PLDTHOMEFIBR_a1b2', password: 'pa;ss:wd', security: 'WPA / WPA2 / WPA3', hidden: false });
    expect(parseWifiQr('WIFI:T:nopass;S:Cafe Free;;')).toMatchObject({ ssid: 'Cafe Free', password: '', security: 'None (open)' });
    expect(parseWifiQr('WIFI:T:WEP;S:Old;P:abcde;H:true;;')).toMatchObject({ security: 'WEP', hidden: true });
    expect(parseWifiQr('https://example.com')).toBeNull();
    expect(parseWifiQr('WIFI:T:WPA;P:x;;')).toBeNull();
  });
  it('round-trips with the codes VaultLocks makes', () => {
    const net = { ssid: 'Juan’s Wi-Fi; 5G', password: String.raw`a\b"c,d`, security: 'WPA / WPA2 / WPA3', hidden: true };
    expect(parseWifiQr(wifiQrText(net))).toEqual({ ...net });
  });
  it('a sticker QR fills the Wi-Fi form exactly', () => {
    const r = parseScanQr('wifiNetwork', 'WIFI:T:WPA;S:Converge_2.4G_ABCD;P:9f8e7d6c;;')!;
    expect(r.viaQr).toBe(true);
    expect(r.fields).toEqual({ ssid: 'Converge_2.4G_ABCD', password: '9f8e7d6c', security: 'WPA / WPA2 / WPA3', hidden: 'No' });
    expect(r.title).toBe('Converge_2.4G_ABCD');
    expect(parseScanQr('wifiNetwork', 'hello')).toBeNull();
    expect(parseScanQr('giftcards', '6061023456789012')?.fields).toEqual({ cardNumber: '6061023456789012' });
    expect(parseScanQr('cards', '4111111111111111')).toBeNull();
  });
});

describe('router stickers (printed text)', () => {
  it('PLDT: "Wireless Network Name (SSID): …" and "Wireless Password: …"', () => {
    const r = parseScan('wifiNetwork', ['PLDT HOME FIBR', 'Wireless Network Name (SSID): PLDTHOMEFIBR_a1b2c3', 'Wireless Password: PLDTWIFIx7k2m', 'Username: adminpldt', 'Password: 1234567890']);
    expect(r.fields).toMatchObject({ ssid: 'PLDTHOMEFIBR_a1b2c3', password: 'PLDTWIFIx7k2m' });
  });
  it('Huawei: label and value on separate lines, admin login skipped', () => {
    const r = parseScan('wifiNetwork', ['HUAWEI', 'WLAN Name', 'HUAWEI-B315-6F2A', 'WLAN Key', 'Q7R2T9B4', 'Web Password: admin']);
    expect(r.fields).toMatchObject({ ssid: 'HUAWEI-B315-6F2A', password: 'Q7R2T9B4' });
  });
  it('frequency in the label and OCR spaces around "_"', () => {
    const r = parseScan('wifiNetwork', ['SSID 5G: GlobeAtHome _ 9C3F', 'Key: 3F9A1B7C']);
    expect(r.fields).toMatchObject({ ssid: 'GlobeAtHome_9C3F', password: '3F9A1B7C' });
  });
  it('never takes the router admin password', () => {
    expect(parseScan('wifiNetwork', ['SSID: Home', 'Admin Password: admin123']).fields.password).toBeUndefined();
  });
});

describe('names on cards', () => {
  it('skips slogans, product names and brand lines; prefers the line under the number', () => {
    const r = parseScan('cards', ['BPI', 'AMORE CASHBACK', 'PLATINUM', '4111 1111 1111 1111', 'VALID THRU 12/28', 'MARIA CLARA SANTOS', 'THANK YOU']);
    expect(r.fields.cardholder).toBe('MARIA CLARA SANTOS');
    const s = parseScan('cards', ['METROBANK', 'WORLD MASTERCARD', 'JUAN DELA CRUZ', '5500 0000 0000 0004', '01/30']);
    expect(s.fields.cardholder).toBe('JUAN DELA CRUZ');
    expect(s.fields.bankName).toBe('Metrobank');
  });
  it('Title Case names work too; nothing name-like → no name', () => {
    expect(parseScan('cards', ['GCash', '4111 1111 1111 1111', 'Christian James']).fields.cardholder).toBe('Christian James');
    expect(parseScan('cards', ['BDO', 'DEBIT', '4111 1111 1111 1111']).fields.cardholder).toBeUndefined();
  });
});
