import { describe, expect, it } from 'vitest';
import { cfg, codes, dualPreset, P, run } from './helpers';

describe('validate', () => {
  it('accepts the dual-bank preset with only the unused info', () => {
    const { issues } = run(dualPreset());
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(issues.find((i) => i.code === 'unused')?.message).toContain('0 bytes unused');
  });

  it('detects overlap', () => {
    const c = codes(cfg([P('a', '16K'), P('b', '16K', { offset: '8K' })]), 'error');
    expect(c).toContain('overlap');
  });

  it('detects a containing overlap behind another partition', () => {
    const c = cfg([P('a', '64K'), P('b', '8K', { offset: '8K' }), P('c', '8K', { offset: '16K' })]);
    expect(run(c).issues.filter((i) => i.code === 'overlap')).toHaveLength(2);
  });

  it('detects partitions exceeding the region', () => {
    const c = cfg([P('a', '300K'), P('b', '300K')]);
    expect(codes(c, 'error')).toContain('exceeds');
  });

  it('uses the bank as the limit in dual mode', () => {
    const c = cfg([P('a', '300K')], { dualBank: true });
    expect(codes(c, 'error')).toContain('exceeds');
  });

  it('warns about gaps', () => {
    const { issues } = run(cfg([P('a', '16K'), P('b', '16K', { offset: '0x8000' })]));
    expect(issues.find((i) => i.code === 'gap')?.severity).toBe('warning');
  });

  it('flags zero and negative sizes', () => {
    expect(codes(cfg([P('a', '0')]))).toContain('size-zero');
    expect(codes(cfg([P('a', '-4K')]))).toContain('size-negative');
  });

  it('flags a negative remainder for fill', () => {
    const c = cfg([P('a', '600K'), P('b', '0', { fill: true })]);
    expect(codes(c)).toContain('size-negative');
  });

  it('flags fill on a non-last partition', () => {
    expect(codes(cfg([P('a', '8K', { fill: true }), P('b', '8K')]))).toContain('fill-not-last');
  });

  it('alignment severity follows the selected mode', () => {
    const parts = [P('a', '0x1800'), P('b', '8K')];
    const asError = run(cfg(parts, { alignMode: 'error' })).issues.filter((i) => i.code.startsWith('unaligned'));
    const asWarn = run(cfg(parts, { alignMode: 'warning' })).issues.filter((i) => i.code.startsWith('unaligned'));
    expect(asError.map((i) => i.code).sort()).toEqual(['unaligned-size', 'unaligned-start']);
    expect(asError.every((i) => i.severity === 'error')).toBe(true);
    expect(asWarn.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('flags empty and duplicate names', () => {
    expect(codes(cfg([P('', '8K')]))).toContain('name-empty');
    expect(codes(cfg([P('a', '8K', { id: '1' }), P('A', '8K', { id: '2' })]))).toContain('name-duplicate');
  });

  it('reports bytes unused', () => {
    const { issues } = run(cfg([P('a', '0x2000')]));
    expect(issues.find((i) => i.code === 'unused')?.message).toContain(`${0x80000 - 0x2000} bytes unused`);
  });

  it('validates RAM reserve', () => {
    const c = cfg([P('a', '8K')]);
    c.ram.reservedTop = '128K';
    expect(codes(c, 'error')).toContain('ram-reserved');
  });

  it('rejects an odd dual-bank region', () => {
    const c = cfg([P('a', '8K')], { dualBank: true });
    c.region.size = '0x80001';
    expect(codes(c, 'error')).toContain('dual-odd');
  });

  it('reports bad region/page input', () => {
    const c = cfg([]);
    c.region.size = '';
    c.page = '0';
    expect(codes(c, 'error')).toEqual(expect.arrayContaining(['region-size', 'page']));
  });
});
