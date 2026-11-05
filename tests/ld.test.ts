import { describe, expect, it } from 'vitest';
import { generateAll, generateHeader, generateLdFiles } from '../src/core/ld';
import { computeLayout } from '../src/core/layout';
import { cfg, dualPreset, P } from './helpers';

const gen = (c = dualPreset()) => {
  const L = computeLayout(c);
  return { L, files: generateLdFiles(c, L), header: generateHeader(c, L) };
};

describe('linker script generation', () => {
  it('produces the documented MEMORY format for the app partition', () => {
    const c = dualPreset();
    c.output.symbols = false;
    const app = gen(c).files.find((f) => f.filename === 'app.ld')!;
    expect(app.content).toContain('MEMORY\n{\n  ROM (rx) : org = 0x08008000, len = 0x38000\n  RAM (xrw) : org = 0x20000000, len = 0x20000\n}');
  });

  it('creates one file per partition plus the header', () => {
    const c = dualPreset();
    expect(generateAll(c, computeLayout(c)).map((f) => f.filename)).toEqual(['bootloader.ld', 'header.ld', 'app.ld', 'memory_map.h']);
  });

  it('dedupes colliding file names', () => {
    const c = cfg([P('a', '8K', { id: '1' }), P('a', '8K', { id: '2' })]);
    expect(gen(c).files.map((f) => f.filename)).toEqual(['a.ld', 'a_2.ld']);
  });

  it('carves out reserved RAM at the top', () => {
    const c = dualPreset();
    c.ram.reservedTop = '0x100';
    const out = gen(c).files[0].content;
    expect(out).toContain('RAM (xrw) : org = 0x20000000, len = 0x1FF00');
    expect(out).toContain('RAM_NOINIT (xrw) : org = 0x2001FF00, len = 0x100');
  });

  it('omits RAM when disabled', () => {
    const c = dualPreset();
    c.ram.enabled = false;
    expect(gen(c).files[0].content).not.toContain('RAM');
  });

  it('supports expressions', () => {
    const c = dualPreset();
    c.output.expressions = true;
    const out = gen(c).files[2].content;
    expect(out).toContain('ROM (rx) : org = 0x08000000 + 0x8000, len = 0x40000 - 0x8000');
  });

  describe('snapshots', () => {
    it('MEMORY only, dual-bank, symbols', () => {
      const { files, header } = gen();
      for (const f of files) expect(f.content).toMatchSnapshot(f.filename);
      expect(header.content).toMatchSnapshot('memory_map.h');
    });
    it('MEMORY only, expressions, no symbols', () => {
      const c = dualPreset();
      c.output.expressions = true;
      c.output.symbols = false;
      expect(gen(c).files[2].content).toMatchSnapshot();
    });
    it('full template with reserved RAM', () => {
      const c = dualPreset();
      c.output.mode = 'full';
      c.ram.reservedTop = '16';
      expect(gen(c).files[2].content).toMatchSnapshot();
    });
    it('single bank header', () => {
      const c = cfg([P('boot', '16K'), P('app', '0', { fill: true })]);
      expect(gen(c).header.content).toMatchSnapshot();
    });
  });
});
