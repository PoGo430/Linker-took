export type AlignMode = 'error' | 'warning';
export type PartitionKind = 'shared' | 'update';
export type OutputMode = 'memory' | 'full';

export interface PartitionInput {
  id: string;
  name: string;
  /** Raw user text, e.g. "32K". Ignored when `fill` is set on the last partition. */
  size: string;
  /** Raw user text, offset from the start of the region (bank). Empty = right after the previous one. */
  offset: string;
  /** Last partition only: take all remaining space. */
  fill: boolean;
  color: string;
  /** shared = identical in both banks (e.g. bootloader); update = target of firmware updates. */
  kind: PartitionKind;
}

export interface Config {
  version: 1;
  region: { name: string; start: string; size: string };
  page: string;
  alignMode: AlignMode;
  dualBank: boolean;
  partitions: PartitionInput[];
  ram: { enabled: boolean; start: string; size: string; reservedTop: string };
  output: { mode: OutputMode; expressions: boolean; symbols: boolean };
}

export const PALETTE = [
  '#4c78a8', '#f58518', '#54a24b', '#b279a2', '#e45756', '#72b7b2', '#eeca3b', '#9d755d',
];

let counter = 0;
export function newId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function emptyConfig(): Config {
  return {
    version: 1,
    region: { name: 'FLASH', start: '0x08000000', size: '512K' },
    page: '0x2000',
    alignMode: 'error',
    dualBank: false,
    partitions: [],
    ram: { enabled: true, start: '0x20000000', size: '128K', reservedTop: '0' },
    output: { mode: 'memory', expressions: false, symbols: true },
  };
}

const str = (v: unknown, d: string): string =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : d;
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Validate untrusted JSON (file upload, URL hash, localStorage) into a well-formed Config. */
export function sanitizeConfig(raw: unknown): Config | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = obj(raw);
  const d = emptyConfig();
  if (!('region' in r) && !('partitions' in r)) return null;
  const region = obj(r.region);
  const ram = obj(r.ram);
  const out = obj(r.output);
  const seen = new Set<string>();
  const parts = Array.isArray(r.partitions) ? r.partitions : [];
  const partitions: PartitionInput[] = parts.slice(0, 64).map((p, i) => {
    const q = obj(p);
    let id = str(q.id, '') || newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    return {
      id,
      name: str(q.name, `part${i + 1}`),
      size: str(q.size, '0'),
      offset: str(q.offset, ''),
      fill: bool(q.fill, false),
      color: /^#[0-9a-f]{6}$/i.test(str(q.color, '')) ? str(q.color, '') : PALETTE[i % PALETTE.length],
      kind: q.kind === 'shared' ? 'shared' : 'update',
    };
  });
  return {
    version: 1,
    region: {
      name: str(region.name, d.region.name),
      start: str(region.start, d.region.start),
      size: str(region.size, d.region.size),
    },
    page: str(r.page, d.page),
    alignMode: r.alignMode === 'warning' ? 'warning' : 'error',
    dualBank: bool(r.dualBank, false),
    partitions,
    ram: {
      enabled: bool(ram.enabled, d.ram.enabled),
      start: str(ram.start, d.ram.start),
      size: str(ram.size, d.ram.size),
      reservedTop: str(ram.reservedTop, '0'),
    },
    output: {
      mode: out.mode === 'full' ? 'full' : 'memory',
      expressions: bool(out.expressions, false),
      symbols: bool(out.symbols, true),
    },
  };
}
