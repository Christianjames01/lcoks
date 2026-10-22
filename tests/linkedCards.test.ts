import { afterEach, describe, expect, it } from 'vitest';
import { cardTheme, linkedLookFor, setLinkedLooks } from '../src/shared/cards';

afterEach(() => setLinkedLooks([]));

describe('Vault cards follow the Expenses card colour', () => {
  it('same bank name uses the chosen colour', () => {
    const before = cardTheme('BDO', 'BDO Savings').background;
    setLinkedLooks([{ name: 'BDO', color: '#5b3cc4' }]);
    const after = cardTheme('BDO', 'BDO Savings').background;
    expect(after).not.toBe(before);
    expect(after).toContain('#5b3cc4');
    expect(cardTheme('BDO', 'BDO Savings').label).toBe('BDO');
  });
  it('the longest matching name wins', () => {
    setLinkedLooks([
      { name: 'BDO', color: '#111111' },
      { name: 'BDO Mastercard', color: '#f59e0b' }
    ]);
    expect(linkedLookFor('BDO', 'BDO Mastercard')?.color).toBe('#f59e0b');
    expect(linkedLookFor('BDO', 'BDO Savings')?.color).toBe('#111111');
  });
  it('accounts without a custom look, and unrelated cards, are left alone', () => {
    setLinkedLooks([{ name: 'GCash' }, { name: 'Maya', color: '#0f9d58' }]);
    expect(linkedLookFor('GCash', 'My GCash')).toBeUndefined();
    expect(linkedLookFor('BPI', 'BPI Savings')).toBeUndefined();
  });
  it('style only restyles the brand colour', () => {
    setLinkedLooks([{ name: 'BDO', style: 'black' }]);
    expect(cardTheme('BDO', 'BDO card').background).toContain('#0b0b0c');
  });
});
