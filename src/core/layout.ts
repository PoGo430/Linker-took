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

export interface ResolvedRamRegion {
  id: string;
  index: number;
  name: string;
  color: string;
  noinit: boolean;
  fill: boolean;
  fillRequested: boolean;
  offset: bigint;
  size: bigint;
  endOffset: bigint;
  /** Absolute address. */
  start: bigint;
  /** Exclusive absolute end. */
  end: bigint;
  sizeError?: string;
  offsetError?: string;
}

export interface RamLayout {
  start: bigint;
  size: bigint;
  /** Legacy reserved-at-top bytes (0 once the RAM is split). */
  reserved: bigint;
  errors: string[];
  /** Resolved RAM regions; empty = classic single-region behaviour. */
  split: ResolvedRamRegion[];
  /** Gaps / free space inside the RAM (split mode only). */
  segments: Segment[];
  used: bigint;
  unused: bigint;
  step: bigint;
  stepError?: string;
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

interface SeqInput {
  size: string;
  offset: string;
  fill: boolean;
}
interface SeqOut {
  offset: bigint;
  size: bigint;
  endOffset: bigint;
  fill: boolean;
  sizeError?: string;
  offsetError?: string;
}

/** Place items back to back (or at fixed offsets) inside `total` bytes; "fill" applies to the last item only. */
function resolveSeq(items: SeqInput[], total: bigint): SeqOut[] {
  const out: SeqOut[] = [];
  let cursor = 0n;
  items.forEach((p, index) => {
    const isLast = index === items.length - 1;
    const off = p.offset.trim() === '' ? null : parseValue(p.offset);
    const offsetError = off && !off.ok ? off.error : undefined;
    const offset = off && off.ok ? off.value : cursor;
    const fill = p.fill && isLast;
    let size: bigint;
    let sizeError: string | undefined;
    if (fill) {
      size = total - offset;
    } else {
      const sz = parseValue(p.size);
      sizeError = sz.ok ? undefined : sz.error;
      size = sz.ok ? sz.value : 0n;
    }
    const endOffset = offset + size;
    cursor = size > 0n ? endOffset : offset;
    out.push({ offset, size, endOffset, fill, sizeError, offsetError });
  });
  return out;
}

/** Free space / gaps (relative to 0..total) from the union of the given intervals. */
function freeSpace(spans: { offset: bigint; endOffset: bigint; size: bigint }[], total: bigint) {
  const ivs = spans
    .filter((p) => p.size > 0n)
    .map((p) => ({ lo: clamp(p.offset, 0n, total), hi: clamp(p.endOffset, 0n, total) }))
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
  if (at < total) segments.push({ kind: 'free', offset: at, endOffset: total });
  return { segments, used, unused: total > 0n ? total - used : 0n };
}

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

  const seq = resolveSeq(config.partitions, bankSize);
  const partitions: ResolvedPartition[] = config.partitions.map((p, index) => {
    const r = seq[index];
    return {
      id: p.id,
      index,
      name: p.name,
      kind: p.kind,
      color: p.color,
      fill: r.fill,
      fillRequested: p.fill,
      offset: r.offset,
      size: r.size,
      endOffset: r.endOffset,
      start: regionStart + r.offset,
      end: regionStart + r.endOffset,
      inactiveStart: dual ? regionStart + bankSize + r.offset : null,
      sizeError: r.sizeError,
      offsetError: r.offsetError,
    };
  });
  const { segments, used, unused } = freeSpace(partitions, bankSize);

  // RAM
  let ram: RamLayout | null = null;
  if (config.ram.enabled) {
    const a = parseValue(config.ram.start);
    const b = parseValue(config.ram.size);
    const c = config.ram.reservedTop.trim() === '' ? { ok: true as const, value: 0n } : parseValue(config.ram.reservedTop);
    const errors: string[] = [];
    if (!a.ok) errors.push(`RAM start: ${a.error}`);
    if (!b.ok) errors.push(`RAM size: ${b.error}`);
    if (!c.ok && !config.ram.split.length) errors.push(`Reserved RAM: ${c.error}`);
    const ramStart = a.ok ? a.value : 0n;
    const ramSize = b.ok ? b.value : 0n;
    const stepP = parseValue(config.ram.step);
    const stepOk = stepP.ok && stepP.value > 0n;
    const seqR = resolveSeq(config.ram.split, ramSize);
    const split: ResolvedRamRegion[] = config.ram.split.map((r, index) => {
      const q = seqR[index];
      return {
        id: r.id,
        index,
        name: r.name,
        color: r.color,
        noinit: r.noinit,
        fill: q.fill,
        fillRequested: r.fill,
        offset: q.offset,
        size: q.size,
        endOffset: q.endOffset,
        start: ramStart + q.offset,
        end: ramStart + q.endOffset,
        sizeError: q.sizeError,
        offsetError: q.offsetError,
      };
    });
    const free = split.length ? freeSpace(split, ramSize) : { segments: [], used: 0n, unused: 0n };
    ram = {
      start: ramStart,
      size: ramSize,
      reserved: split.length ? 0n : c.ok ? c.value : 0n,
      errors,
      split,
      segments: free.segments,
      used: free.used,
      unused: free.unused,
      step: stepOk ? stepP.value : 8n,
      stepError: stepOk ? undefined : stepP.ok ? 'Step must be greater than zero' : stepP.error,
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
