import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex } from '../src/renderer/components/ColorPicker';

describe('colour picker maths', () => {
  it('round-trips colours through hue / saturation / brightness', () => {
    for (const hex of ['#5b3cc4', '#f59e0b', '#000000', '#ffffff', '#0a5bd6', '#c8102e']) expect(hsvToHex(...hexToHsv(hex))).toBe(hex);
  });
  it('known values', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    expect(hexToHsv('#0000ff')[0]).toBe(240);
  });
});
