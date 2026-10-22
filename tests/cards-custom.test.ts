import { describe, expect, it } from 'vitest';
import { validateAccountInput } from '../src/core/schema';
import { accountColor, readableOn } from '../src/shared/money';

describe('customised wallet cards', () => {
  it('keeps a valid colour, style and card-number ending', () => {
    const a = validateAccountInput({ name: 'GCash', kind: 'ewallet', opening: 0, color: '#5B3CC4', style: 'glass', last4: '4821' });
    expect(a).toMatchObject({ color: '#5b3cc4', style: 'glass', last4: '4821' });
  });
  it('drops bad values instead of storing them', () => {
    const a = validateAccountInput({ name: 'BDO', kind: 'bank', opening: 0, color: 'red', style: 'neon', last4: '12a4' });
    expect(a).not.toHaveProperty('color');
    expect(a).not.toHaveProperty('style');
    expect(a).not.toHaveProperty('last4');
  });
  it('a chosen colour wins over the automatic bank colour, with readable text', () => {
    expect(accountColor({ name: 'GCash', kind: 'ewallet' }).bg).toBe('#0a5bd6');
    expect(accountColor({ name: 'GCash', kind: 'ewallet', color: '#f59e0b' }).bg).toBe('#f59e0b');
    expect(readableOn('#ffffff')).toBe('#111111');
    expect(readableOn('#1c1c1e')).toBe('#ffffff');
  });
});
