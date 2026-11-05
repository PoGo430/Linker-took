import { describe, expect, it } from 'vitest';
import { crc32, createZip } from '../src/core/zip';

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('writes a structurally valid archive', () => {
    const z = createZip([{ name: 'a.ld', data: 'hello' }, { name: 'dir/b.h', data: 'world!' }], new Date(2026, 0, 2, 3, 4, 6));
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const eocd = z.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 10, true)).toBe(2);
    const cdOffset = dv.getUint32(eocd + 16, true);
    expect(dv.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(dv.getUint32(cdOffset + 16, true)).toBe(crc32(new TextEncoder().encode('hello')));
  });
});
