import { describe, expect, it } from 'vitest';
import { formatAddr, formatHex, formatKb, hexKb, parseValue } from '../src/core/units';

const v = (s: string) => {
  const r = parseValue(s);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('parseValue', () => {
  it('parses hex, decimal and suffixes', () => {
    expect(v('0x8000')).toBe(0x8000n);
    expect(v('0X08000000')).toBe(0x08000000n);
    expect(v('32768')).toBe(32768n);
    expect(v('32K')).toBe(0x8000n);
    expect(v('32k')).toBe(0x8000n);
    expect(v('32KB')).toBe(0x8000n);
    expect(v('32 KiB')).toBe(0x8000n);
    expect(v('512K')).toBe(0x80000n);
    expect(v('1M')).toBe(0x100000n);
    expect(v('4G')).toBe(0x100000000n);
    expect(v('0x2K')).toBe(0x800n);
    expect(v('64B')).toBe(64n);
    expect(v('1_000')).toBe(1000n);
  });
  it('supports exact fractions without floating point', () => {
    expect(v('1.5K')).toBe(1536n);
    expect(v('0.25M')).toBe(262144n);
    expect(v('.5K')).toBe(512n);
  });
  it('rejects fractions that are not whole bytes', () => {
    expect(parseValue('1.3K').ok).toBe(false);
    expect(parseValue('0.5').ok).toBe(false);
  });
  it('is exact beyond 2^53', () => {
    expect(v('0xFFFFFFFFFFFFFFFF')).toBe(18446744073709551615n);
  });
  it('handles signs', () => {
    expect(v('-4K')).toBe(-4096n);
    expect(v('+0x10')).toBe(16n);
  });
  it('rejects garbage', () => {
    for (const s of ['', '  ', 'abc', '0x', '12Q', '1..5', '--4', '0xZZ', '1 2']) {
      expect(parseValue(s).ok, s).toBe(false);
    }
  });
});

describe('formatting', () => {
  it('formats hex and addresses', () => {
    expect(formatHex(0x38000n)).toBe('0x38000');
    expect(formatHex(255n)).toBe('0xFF');
    expect(formatHex(-16n)).toBe('-0x10');
    expect(formatAddr(0x8000n)).toBe('0x00008000');
    expect(formatAddr(0x20000000n)).toBe('0x20000000');
  });
  it('formats kB exactly', () => {
    expect(formatKb(0x8000n)).toBe('32 kB');
    expect(formatKb(0n)).toBe('0 kB');
    expect(formatKb(100n)).toBe('100 B');
    expect(formatKb(1036n)).toBe('1 kB + 12 B');
    expect(formatKb(-2048n)).toBe('-2 kB');
    expect(hexKb(0x2000n)).toBe('0x2000 (8 kB)');
  });
});
