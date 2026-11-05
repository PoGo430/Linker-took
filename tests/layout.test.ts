import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/core/layout';
import { cfg, dualPreset, P } from './helpers';

describe('computeLayout', () => {
  it('places partitions back to back', () => {
    const L = computeLayout(cfg([P('a', '16K'), P('b', '0x2000'), P('c', '32K')]));
    expect(L.partitions.map((p) => [p.offset, p.size, p.start])).toEqual([
      [0n, 0x4000n, 0x08000000n],
      [0x4000n, 0x2000n, 0x08004000n],
      [0x6000n, 0x8000n, 0x08006000n],
    ]);
    expect(L.usedPerBank).toBe(0xe000n);
    expect(L.unusedPerBank).toBe(0x80000n - 0xe000n);
    expect(L.segments).toEqual([{ kind: 'free', offset: 0xe000n, endOffset: 0x80000n }]);
  });

  it('honours fixed offsets and reports gaps', () => {
    const L = computeLayout(cfg([P('a', '16K'), P('b', '16K', { offset: '0x8000' }), P('c', '16K')]));
    expect(L.partitions[1].start).toBe(0x08008000n);
    expect(L.partitions[2].offset).toBe(0xc000n); // continues after b
    expect(L.segments[0]).toEqual({ kind: 'gap', offset: 0x4000n, endOffset: 0x8000n });
  });

  it('fills the remaining space on the last partition', () => {
    const L = computeLayout(cfg([P('a', '0x8000'), P('b', '0', { fill: true })]));
    expect(L.partitions[1].size).toBe(0x80000n - 0x8000n);
    expect(L.unusedPerBank).toBe(0n);
    expect(L.segments).toEqual([]);
  });

  it('ignores fill on non-last partitions', () => {
    const L = computeLayout(cfg([P('a', '8K', { fill: true }), P('b', '8K')]));
    expect(L.partitions[0].fill).toBe(false);
    expect(L.partitions[0].fillRequested).toBe(true);
    expect(L.partitions[0].size).toBe(0x2000n);
  });

  it('splits the region into two banks in dual mode', () => {
    const L = computeLayout(dualPreset());
    expect(L.bankSize).toBe(0x40000n);
    expect(L.bankStarts).toEqual([0x08000000n, 0x08040000n]);
    const app = L.partitions[2];
    expect(app.start).toBe(0x08008000n);
    expect(app.size).toBe(0x38000n);
    expect(app.inactiveStart).toBe(0x08048000n);
    expect(L.unusedPerBank).toBe(0n);
  });

  it('does not double count overlapping partitions in the used total', () => {
    const L = computeLayout(cfg([P('a', '16K'), P('b', '16K', { offset: '8K' })]));
    expect(L.usedPerBank).toBe(0x6000n);
  });

  it('survives unparsable input', () => {
    const L = computeLayout(cfg([P('a', 'zzz')], { page: 'x' }));
    expect(L.partitions[0].sizeError).toBeTruthy();
    expect(L.pageError).toBeTruthy();
  });
});
