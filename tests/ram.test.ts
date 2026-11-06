import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/core/layout';
import { generateAll, generateHeader, generateLdFiles } from '../src/core/ld';
import { PRESETS } from '../src/core/presets';
import { decodeConfig, encodeConfig, hashFromConfig, configFromHash } from '../src/core/share';
import { sanitizeConfig, type Config, type RamRegionInput } from '../src/core/model';
import { codes, dualPreset, P, run, cfg } from './helpers';

const R = (name: string, size: string, extra: Partial<RamRegionInput> = {}): RamRegionInput => ({
  id: name, name, size, offset: '', fill: false, color: '#888888', noinit: false, ...extra,
});
const withSplit = (regions: RamRegionInput[], base: Config = dualPreset()): Config => {
  const c = structuredClone(base);
  c.ram.split = regions;
  return c;
};
const files = (c: Config) => generateAll(c, computeLayout(c));
const memory = (text: string) => {
  const i = text.indexOf('\nMEMORY\n') + 1;
  return text.slice(i, text.indexOf('}', i) + 1);
};

/** A configuration exactly as the first released version saved it (no split/step/ram fields). */
const LEGACY = {
  version: 1,
  region: { name: 'FLASH', start: '0x08000000', size: '512K' },
  page: '0x2000',
  alignMode: 'error',
  dualBank: true,
  partitions: [
    { id: 'bootloader', name: 'bootloader', size: '24K', offset: '', fill: false, color: '#4c78a8', kind: 'shared' },
    { id: 'header', name: 'header', size: '8K', offset: '', fill: false, color: '#eeca3b', kind: 'update' },
    { id: 'app', name: 'app', size: '224K', offset: '', fill: false, color: '#54a24b', kind: 'update' },
  ],
  ram: { enabled: true, start: '0x20000000', size: '128K', reservedTop: '0' },
  output: { mode: 'memory', expressions: false, symbols: true },
};
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('backwards compatibility', () => {
  it('loads an old-format config and generates exactly the same files as the preset', () => {
    const old = sanitizeConfig(LEGACY)!;
    expect(old.ram.split).toEqual([]);
    expect(old.partitions.every((p) => p.ram === '')).toBe(true);
    expect(files(old)).toEqual(files(dualPreset()));
  });

  it('decodes an old-format share URL hash', () => {
    const url = `#c=${b64url(JSON.stringify(LEGACY))}`;
    const c = configFromHash(url)!;
    expect(c).not.toBeNull();
    const app = generateLdFiles(c, computeLayout(c)).find((f) => f.filename === 'app.ld')!;
    expect(app.content).toContain('ROM (rx) : org = 0x08008000, len = 0x38000');
    expect(app.content).toContain('RAM (xrw) : org = 0x20000000, len = 0x20000');
  });

  it('still honours the legacy reserved-RAM-at-top', () => {
    const c = sanitizeConfig({ ...LEGACY, ram: { ...LEGACY.ram, reservedTop: '0x100' } })!;
    const out = files(c)[0].content;
    expect(out).toContain('RAM (xrw) : org = 0x20000000, len = 0x1FF00');
    expect(out).toContain('RAM_NOINIT (xrw) : org = 0x2001FF00, len = 0x100');
  });

  it('new configs round-trip through JSON and the URL hash', () => {
    const c = PRESETS.find((p) => p.id === 'stm32c562re-dual-ramsplit')!.build();
    expect(decodeConfig(encodeConfig(c))).toEqual(c);
    expect(configFromHash(hashFromConfig(c))).toEqual(c);
  });

  it('existing presets are unchanged: no split, no RAM validation noise', () => {
    for (const id of ['stm32c562re-dual', 'generic-single', 'empty']) {
      const c = PRESETS.find((p) => p.id === id)!.build();
      expect(c.ram.split).toEqual([]);
      const { issues } = run(c);
      expect(issues.filter((i) => i.code.startsWith('ram'))).toEqual([]);
    }
  });

  it('a split equivalent to the legacy reserve produces the same MEMORY block', () => {
    const legacy = dualPreset();
    legacy.ram.reservedTop = '0x100';
    const split = withSplit([R('main', '0x1FF00'), R('shared', '0x100', { noinit: true })]);
    const a = generateLdFiles(legacy, computeLayout(legacy))[2].content;
    const b = generateLdFiles(split, computeLayout(split))[2].content;
    expect(memory(b)).toBe(memory(a));
  });
});

describe('RAM split layout', () => {
  it('places regions back to back and fills the rest', () => {
    const c = withSplit([R('a', '32K'), R('b', '0', { fill: true })]);
    const L = computeLayout(c).ram!;
    expect(L.split.map((r) => [r.offset, r.size, r.start])).toEqual([
      [0n, 0x8000n, 0x20000000n],
      [0x8000n, 0x18000n, 0x20008000n],
    ]);
    expect(L.unused).toBe(0n);
  });
  it('reports used / unused and gaps', () => {
    const c = withSplit([R('a', '32K'), R('b', '16K', { offset: '0xC000' })]);
    const L = computeLayout(c).ram!;
    expect(L.used).toBe(0xc000n);
    expect(L.segments.map((s) => s.kind)).toEqual(['gap', 'free']);
  });
  it('ignores the legacy reserve while split', () => {
    const c = withSplit([R('a', '64K')]);
    c.ram.reservedTop = '1M';
    expect(computeLayout(c).ram!.reserved).toBe(0n);
    expect(codes(c, 'error')).not.toContain('ram-reserved');
  });
});

describe('RAM split verification', () => {
  const ok = () => dualPreset();
  it('accepts the RAM-split preset', () => {
    const c = PRESETS.find((p) => p.id === 'stm32c562re-dual-ramsplit')!.build();
    const bad = run(c).issues.filter((i) => i.severity !== 'info');
    expect(bad).toEqual([]);
    expect(run(c).issues.find((i) => i.code === 'ram-unused')?.message).toContain('0 bytes RAM unused');
  });
  it('flags overlap, overflow, zero and negative sizes', () => {
    expect(codes(withSplit([R('a', '32K'), R('b', '32K', { offset: '16K' })], ok()), 'error')).toContain('ram-overlap');
    expect(codes(withSplit([R('a', '200K')], ok()), 'error')).toContain('ram-exceeds');
    expect(codes(withSplit([R('a', '0')], ok()), 'error')).toContain('ram-size-zero');
    expect(codes(withSplit([R('a', '-4K')], ok()), 'error')).toContain('ram-size-negative');
    expect(codes(withSplit([R('a', '130K'), R('b', '0', { fill: true })], ok()), 'error')).toContain('ram-size-negative');
  });
  it('flags names, fill placement and noinit rules', () => {
    expect(codes(withSplit([R('', '8K')], ok()), 'error')).toContain('ram-name-empty');
    expect(codes(withSplit([R('x', '8K', { id: '1' }), R('X', '8K', { id: '2' })], ok()), 'error')).toContain('ram-name-duplicate');
    expect(codes(withSplit([R('a', '8K', { fill: true }), R('b', '8K')], ok()), 'error')).toContain('ram-fill-not-last');
    expect(codes(withSplit([R('a', '8K'), R('n1', '8K', { noinit: true }), R('n2', '8K', { noinit: true })], ok()), 'error')).toContain('ram-noinit-multiple');
    expect(codes(withSplit([R('n', '8K', { noinit: true })], ok()), 'error')).toContain('ram-no-main');
  });
  it('warns about gaps and misalignment', () => {
    expect(codes(withSplit([R('a', '16K'), R('b', '16K', { offset: '0x8000' })], ok()), 'warning')).toContain('ram-gap');
    expect(codes(withSplit([R('a', '0x1002')], ok()), 'warning')).toContain('ram-align');
  });
  it('warns when a region cannot hold the template heap + stack', () => {
    const c = withSplit([R('tiny', '0x100'), R('rest', '0', { fill: true })], ok());
    c.output.mode = 'full';
    expect(codes(c, 'warning')).toContain('ram-too-small');
    c.output.mode = 'memory';
    expect(codes(c, 'warning')).not.toContain('ram-too-small');
  });
  it('validates partition → region references', () => {
    const c = withSplit([R('a', '64K'), R('n', '8K', { noinit: true })], ok());
    c.partitions[0].ram = 'gone';
    c.partitions[1].ram = 'n';
    expect(codes(c, 'error')).toEqual(expect.arrayContaining(['ram-ref-missing', 'ram-ref-noinit']));
  });
  it('does not validate the split when RAM is disabled', () => {
    const c = withSplit([R('a', '0')], ok());
    c.ram.enabled = false;
    expect(codes(c).filter((x) => x.startsWith('ram'))).toEqual([]);
  });
  it('works for a single-bank config too', () => {
    const c = cfg([P('app', '16K')]);
    c.ram.split = [R('a', '64K')];
    expect(run(c).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('RAM split generation', () => {
  const c = PRESETS.find((p) => p.id === 'stm32c562re-dual-ramsplit')!.build();
  it('gives each partition its assigned RAM and the shared no-init region', () => {
    const out = Object.fromEntries(generateLdFiles(c, computeLayout(c)).map((f) => [f.filename, f.content]));
    expect(memory(out['bootloader.ld'])).toBe('MEMORY\n{\n  ROM (rx) : org = 0x08000000, len = 0x6000\n  RAM (xrw) : org = 0x20000000, len = 0x8000\n  RAM_NOINIT (xrw) : org = 0x2001E000, len = 0x2000\n}');
    expect(memory(out['app.ld'])).toBe('MEMORY\n{\n  ROM (rx) : org = 0x08008000, len = 0x38000\n  RAM (xrw) : org = 0x20008000, len = 0x16000\n  RAM_NOINIT (xrw) : org = 0x2001E000, len = 0x2000\n}');
    expect(out['app.ld']).toContain('PROVIDE(_ram_app_ram_start = 0x20008000);');
  });
  it('falls back to the first normal region when unassigned', () => {
    const d = structuredClone(c);
    d.partitions[2].ram = '';
    expect(generateLdFiles(d, computeLayout(d))[2].content).toContain('RAM (xrw) : org = 0x20000000, len = 0x8000');
  });
  it('supports expressions and the full template .noinit section', () => {
    const d = structuredClone(c);
    d.output.expressions = true;
    d.output.mode = 'full';
    const app = generateLdFiles(d, computeLayout(d))[2].content;
    expect(app).toContain('RAM (xrw) : org = 0x20000000 + 0x8000, len = 0x1E000 - 0x8000');
    expect(app).toContain('.noinit (NOLOAD)');
    expect(app).toContain('>RAM_NOINIT');
  });
  it('exports region constants in the header', () => {
    const h = generateHeader(c, computeLayout(c)).content;
    expect(h).toContain('RAM_REGION_APP_RAM_START');
    expect(h).toContain('RAM_NOINIT_START');
    expect(h).toContain('0x2001E000UL');
  });
  it('snapshots', () => {
    const f = Object.fromEntries(files(c).map((x) => [x.filename, x.content]));
    expect(f['app.ld']).toMatchSnapshot('app.ld');
    expect(f['memory_map.h']).toMatchSnapshot('memory_map.h');
  });
});
