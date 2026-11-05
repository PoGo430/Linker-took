import { parseValue } from './units';
import type { Config } from './model';

export interface ResolvedPartition {
  id: string;
  index: number;
  name: string;
  kind: 'shared' | 'update';
  color: string;
  /** Effective fill-remaining (only honoured on the last partition). */
  fill: boolean;
  fillRequested: boolean;
  /** Offset within the bank. */
  offset: bigint;
  size: bigint;
  /** Exclusive end offset within the bank. */
  endOffset: bigint;
  /** Absolute address in bank 1 (the one linker scripts are generated from). */
  start: bigint;
  /** Exclusive absolute end in bank 1. */
  end: bigint;
  /** Absolute start in the other bank (dual-bank mode only). */
  inactiveStart: bigint | null;
  sizeError?: string;
  offsetError?: string;
}

export interface Segment {
  /** gap = free space followed by a partition; free = trailing free space. */
  kind: 'gap' | 'free';
  offset: bigint;
  endOffset: bigint;
}

export interface RamLayout {
  start: bigint;
  size: bigint;
  reserved: bigint;
  errors: string[];
}

export interface Layout {
  regionStart: bigint;
  regionSize: bigint;
  page: bigint;
  regionStartError?: string;
  regionSizeError?: string;
  pageError?: string;
  dual: boolean;
  bankSize: bigint;
  /** Absolute start address of each bank. */
  bankStarts: bigint[];
  partitions: ResolvedPartition[];
  segments: Segment[];
  usedPerBank: bigint;
  unusedPerBank: bigint;
  ram: RamLayout | null;
}

const clamp = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);

export function computeLayout(config: Config): Layout {
  const rs = parseValue(config.region.start);
  const rz = parseValue(config.region.size);
  const pg = parseValue(config.page);
  const regionStart = rs.ok ? rs.value : 0n;
  const regionSize = rz.ok ? rz.value : 0n;
  const page = pg.ok ? pg.value : 0n;
  const dual = config.dualBank;
  const bankSize = dual ? regionSize / 2n : regionSize;
  const bankStarts = dual ? [regionStart, regionStart + bankSize] : [regionStart];

  const partitions: ResolvedPartition[] = [];
  let cursor = 0n;
  const n = config.partitions.length;
  config.partitions.forEach((p, index) => {
    const isLast = index === n - 1;
    const off = p.offset.trim() === '' ? null : parseValue(p.offset);
    const offsetError = off && !off.ok ? off.error : undefined;
    const offset = off && off.ok ? off.value : cursor;
    const fill = p.fill && isLast;
    let size: bigint;
    let sizeError: string | undefined;
    if (fill) {
      size = bankSize - offset;
    } else {
      const sz = parseValue(p.size);
      sizeError = sz.ok ? undefined : sz.error;
      size = sz.ok ? sz.value : 0n;
    }
    const endOffset = offset + size;
    cursor = size > 0n ? endOffset : offset;
    partitions.push({
      id: p.id,
      index,
      name: p.name,
      kind: p.kind,
      color: p.color,
      fill,
      fillRequested: p.fill,
      offset,
      size,
      endOffset,
      start: regionStart + offset,
      end: regionStart + endOffset,
      inactiveStart: dual ? regionStart + bankSize + offset : null,
      sizeError,
      offsetError,
    });
  });

  // Free space / gaps (bank-relative), computed from the union of partition intervals.
  const ivs = partitions
    .filter((p) => p.size > 0n)
    .map((p) => ({ lo: clamp(p.offset, 0n, bankSize), hi: clamp(p.endOffset, 0n, bankSize) }))
    .filter((v) => v.lo < v.hi)
    .sort((a, b) => (a.lo < b.lo ? -1 : a.lo > b.lo ? 1 : 0));
  const segments: Segment[] = [];
  let at = 0n;
  let used = 0n;
  for (const v of ivs) {
    if (v.lo > at) segments.push({ kind: 'gap', offset: at, endOffset: v.lo });
    if (v.hi > at) {
      used += v.hi - (v.lo > at ? v.lo : at);
      at = v.hi;
    }
  }
  if (at < bankSize) segments.push({ kind: 'free', offset: at, endOffset: bankSize });
  const unused = bankSize > 0n ? bankSize - used : 0n;

  // RAM
  let ram: RamLayout | null = null;
  if (config.ram.enabled) {
    const a = parseValue(config.ram.start);
    const b = parseValue(config.ram.size);
    const c = config.ram.reservedTop.trim() === '' ? { ok: true as const, value: 0n } : parseValue(config.ram.reservedTop);
    const errors: string[] = [];
    if (!a.ok) errors.push(`RAM start: ${a.error}`);
    if (!b.ok) errors.push(`RAM size: ${b.error}`);
    if (!c.ok) errors.push(`Reserved RAM: ${c.error}`);
    ram = {
      start: a.ok ? a.value : 0n,
      size: b.ok ? b.value : 0n,
      reserved: c.ok ? c.value : 0n,
      errors,
    };
  }

  return {
    regionStart,
    regionSize,
    page,
    regionStartError: rs.ok ? undefined : rs.error,
    regionSizeError: rz.ok ? undefined : rz.error,
    pageError: pg.ok ? undefined : pg.error,
    dual,
    bankSize,
    bankStarts,
    partitions,
    segments,
    usedPerBank: used,
    unusedPerBank: unused,
    ram,
  };
}
