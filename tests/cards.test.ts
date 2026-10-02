import { describe, expect, it } from 'vitest';
import { cardTheme, detectCardNetwork, luhnValid, normalizeExpiry } from '../src/shared/cards';

describe('cards', () => {
  it('detects card networks', () => {
    expect(detectCardNetwork('4111 1111 1111 1111')).toBe('visa');
    expect(detectCardNetwork('5500 0000 0000 0004')).toBe('mastercard');
    expect(detectCardNetwork('2223 0000 4841 0010')).toBe('mastercard');
    expect(detectCardNetwork('3782 822463 10005')).toBe('amex');
    expect(detectCardNetwork('3530 1113 3330 0000')).toBe('jcb');
    expect(detectCardNetwork('6011 0009 9013 9424')).toBe('discover');
    expect(detectCardNetwork('6250 9410 0652 8599')).toBe('unionpay');
    expect(detectCardNetwork('9999 0000')).toBeUndefined();
    expect(detectCardNetwork('12')).toBeUndefined();
  });
  it('checks Luhn and expiry formats', () => {
    expect(luhnValid('4111 1111 1111 1111')).toBe(true);
    expect(luhnValid('4111 1111 1111 1112')).toBe(false);
    expect(normalizeExpiry('8/2028')).toBe('08/28');
    expect(normalizeExpiry('12/27')).toBe('12/27');
    expect(normalizeExpiry('13/27')).toBeNull();
  });
  it('picks bank colours from the bank name or title', () => {
    expect(cardTheme('BPI', 'x').label).toBe('BPI');
    expect(cardTheme(undefined, 'My GCash wallet').label).toBe('GCash');
    expect(cardTheme('Some Credit Union', 'x').label).toBe('Some Credit Union');
  });
});
