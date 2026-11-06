import type { Config } from './model';
import type { Layout } from './layout';
import { formatAddr, formatHex, formatKb, hexKb } from './units';

export type Severity = 'error' | 'warning' | 'info';
export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  partitionId?: string;
  /** Set for issues about a RAM region. */
  ramId?: string;
}

/** Characters usable in a file name / C identifier derived from a partition name. */
export const fileSafe = (name: string): string => name.trim().replace(/[^A-Za-z0-9_.-]+/g, '_');
export const identSafe = (name: string): string => {
  const s = name.trim().replace(/[^A-Za-z0-9_]+/g, '_');
  return /^[0-9]/.test(s) ? `_${s}` : s;
};

export function validate(config: Config, L: Layout): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, code: string, message: string, partitionId?: string, ramId?: string) =>
    issues.push({ severity, code, message, partitionId, ramId });
  const alignSev: Severity = config.alignMode === 'warning' ? 'warning' : 'error';
  const bankWord = L.dual ? 'bank' : 'region';

  // --- region ---
  if (L.regionStartError) add('error', 'region-start', `Region start: ${L.regionStartError}`);
  if (L.regionSizeError) add('error', 'region-size', `Region size: ${L.regionSizeError}`);
  else if (L.regionSize <= 0n) add('error', 'region-size', 'Region size must be greater than zero');
  if (L.pageError) add('error', 'page', `Page size: ${L.pageError}`);
  else if (L.page <= 0n) add('error', 'page', 'Page size must be greater than zero');
  const pageOk = L.page > 0n;

  if (L.dual && L.regionSize % 2n !== 0n) {
    add('error', 'dual-odd', 'Dual-bank: region size must be even so it splits into two equal banks');
  }
  if (pageOk) {
    if (L.regionStart % L.page !== 0n) {
      add(alignSev, 'region-align', `Region start ${formatAddr(L.regionStart)} is not aligned to the page size ${formatHex(L.page)}`);
    }
    if (L.bankSize % L.page !== 0n) {
      add(alignSev, 'region-align', `${L.dual ? 'Bank' : 'Region'} size ${hexKb(L.bankSize)} is not a multiple of the page size ${formatHex(L.page)}`);
    }
  }

  // --- partitions ---
  const names = new Map<string, string>();
  for (const p of L.partitions) {
    const label = p.name.trim() || `#${p.index + 1}`;
    if (!p.name.trim()) add('error', 'name-empty', `Partition #${p.index + 1} has no name`, p.id);
    else if (!fileSafe(p.name)) add('error', 'name-invalid', `Partition "${p.name}" has an unusable name`, p.id);
    else {
      const key = fileSafe(p.name).toLowerCase();
      if (names.has(key)) add('error', 'name-duplicate', `Duplicate partition name "${p.name}" (output files would collide)`, p.id);
      names.set(key, p.id);
    }
    if (p.sizeError) add('error', 'size-invalid', `${label}: size — ${p.sizeError}`, p.id);
    if (p.offsetError) add('error', 'offset-invalid', `${label}: offset — ${p.offsetError}`, p.id);
    if (p.fillRequested && !p.fill) {
      add('error', 'fill-not-last', `${label}: "fill remaining" is only allowed on the last partition`, p.id);
    }
    if (!p.sizeError) {
      if (p.size === 0n) add('error', 'size-zero', `${label}: size is zero${p.fill ? ' (no space left to fill)' : ''}`, p.id);
      else if (p.size < 0n) add('error', 'size-negative', `${label}: size is negative (${formatKb(p.size)})${p.fill ? ' — earlier partitions already exceed the ' + bankWord : ''}`, p.id);
    }
    if (p.offset < 0n) add('error', 'offset-negative', `${label}: offset ${formatHex(p.offset)} is before the start of the ${bankWord}`, p.id);
    if (p.size > 0n && p.endOffset > L.bankSize && L.bankSize > 0n) {
      add('error', 'exceeds', `${label}: ends at ${formatAddr(p.end)}, ${hexKb(p.endOffset - L.bankSize)} beyond the end of the ${bankWord} (${formatAddr(L.bankStarts[0] + L.bankSize)})`, p.id);
    }
    if (pageOk && p.size > 0n) {
      if (p.start % L.page !== 0n) add(alignSev, 'unaligned-start', `${label}: start ${formatAddr(p.start)} is not aligned to the ${formatHex(L.page)} page size`, p.id);
      if (p.size % L.page !== 0n) add(alignSev, 'unaligned-size', `${label}: size ${hexKb(p.size)} is not a multiple of the ${formatHex(L.page)} page size`, p.id);
    }
  }

  // --- overlaps (compare against the furthest-reaching earlier partition) ---
  const valid = L.partitions.filter((p) => p.size > 0n).sort((a, b) => (a.offset < b.offset ? -1 : a.offset > b.offset ? 1 : a.index - b.index));
  let reach: (typeof valid)[number] | null = null;
  for (const p of valid) {
    if (reach && p.offset < reach.endOffset) {
      const ovEnd = p.endOffset < reach.endOffset ? p.endOffset : reach.endOffset;
      add('error', 'overlap', `"${p.name}" overlaps "${reach.name}": ${formatAddr(L.regionStart + p.offset)}–${formatAddr(L.regionStart + ovEnd - 1n)} (${hexKb(ovEnd - p.offset)})`, p.id);
    }
    if (!reach || p.endOffset > reach.endOffset) reach = p;
  }

  // --- gaps & free space ---
  for (const s of L.segments) {
    const a = L.regionStart + s.offset;
    const b = L.regionStart + s.endOffset;
    if (s.kind === 'gap') {
      add('warning', 'gap', `Gap of ${hexKb(s.endOffset - s.offset)} between partitions: ${formatAddr(a)}–${formatAddr(b - 1n)}`);
    }
  }
  if (L.bankSize > 0n) {
    const total = L.dual ? L.unusedPerBank * 2n : L.unusedPerBank;
    add('info', 'unused', `${L.unusedPerBank} bytes unused${L.dual ? ' per bank' : ''} = ${hexKb(L.unusedPerBank)}${L.dual ? ` (${total} bytes over both banks)` : ''}`);
  }

  // --- RAM ---
  if (L.ram) {
    for (const e of L.ram.errors) add('error', 'ram-invalid', e);
    if (!L.ram.errors.length) {
      if (L.ram.size <= 0n) add('error', 'ram-size', 'RAM size must be greater than zero');
      if (L.ram.reserved < 0n) add('error', 'ram-reserved', 'Reserved RAM must not be negative');
      else if (L.ram.size > 0n && L.ram.reserved >= L.ram.size) add('error', 'ram-reserved', `Reserved RAM ${hexKb(L.ram.reserved)} leaves no room in the ${hexKb(L.ram.size)} RAM`);
    }
  }
  if (L.ram && L.ram.split.length && !L.ram.errors.length) validateRamSplit(config, L, add);
  return issues;
}

type Add = (severity: Severity, code: string, message: string, partitionId?: string, ramId?: string) => void;

/** Checks for a split RAM: sizes, overlaps, gaps, alignment, no-init rules and partition → region references. */
function validateRamSplit(config: Config, L: Layout, add: Add): void {
  const ram = L.ram!;
  const total = ram.size;
  if (ram.stepError) add('error', 'ram-step', `RAM snap step: ${ram.stepError}`);
  const names = new Map<string, string>();
  let noinitCount = 0;
  for (const r of ram.split) {
    const label = r.name.trim() || `RAM region #${r.index + 1}`;
    if (r.noinit) noinitCount++;
    if (!r.name.trim()) add('error', 'ram-name-empty', `RAM region #${r.index + 1} has no name`, undefined, r.id);
    else {
      const key = identSafe(r.name).toLowerCase();
      if (names.has(key)) add('error', 'ram-name-duplicate', `Duplicate RAM region name "${r.name}"`, undefined, r.id);
      names.set(key, r.id);
    }
    if (r.sizeError) add('error', 'ram-size-invalid', `RAM ${label}: size — ${r.sizeError}`, undefined, r.id);
    if (r.offsetError) add('error', 'ram-offset-invalid', `RAM ${label}: offset — ${r.offsetError}`, undefined, r.id);
    if (r.fillRequested && !r.fill) add('error', 'ram-fill-not-last', `RAM ${label}: "fill remaining" is only allowed on the last region`, undefined, r.id);
    if (!r.sizeError) {
      if (r.size === 0n) add('error', 'ram-size-zero', `RAM ${label}: size is zero${r.fill ? ' (no RAM left to fill)' : ''}`, undefined, r.id);
      else if (r.size < 0n) add('error', 'ram-size-negative', `RAM ${label}: size is negative (${formatKb(r.size)})`, undefined, r.id);
    }
    if (r.offset < 0n) add('error', 'ram-offset-negative', `RAM ${label}: offset ${formatHex(r.offset)} is before the start of RAM`, undefined, r.id);
    if (r.size > 0n && r.endOffset > total) {
      add('error', 'ram-exceeds', `RAM ${label}: ends at ${formatAddr(r.end)}, ${hexKb(r.endOffset - total)} beyond the end of RAM (${formatAddr(ram.start + total)})`, undefined, r.id);
    }
    if (r.size > 0n && (r.start % 8n !== 0n || r.size % 8n !== 0n)) {
      add('warning', 'ram-align', `RAM ${label}: start ${formatAddr(r.start)} / size ${formatHex(r.size)} should be 8-byte aligned (Cortex-M stack alignment)`, undefined, r.id);
    }
    if (config.output.mode === 'full' && !r.noinit && r.size > 0n && r.size < 0x600n) {
      add('warning', 'ram-too-small', `RAM ${label}: ${hexKb(r.size)} is below the 0x600 heap + stack reserved by the full template`, undefined, r.id);
    }
  }
  if (noinitCount > 1) add('error', 'ram-noinit-multiple', 'Only one RAM region can be the shared no-init area');
  if (noinitCount === ram.split.length) add('error', 'ram-no-main', 'Every RAM region is no-init — at least one normal RAM region is needed');

  // overlaps
  const valid = ram.split.filter((r) => r.size > 0n).sort((a, b) => (a.offset < b.offset ? -1 : a.offset > b.offset ? 1 : a.index - b.index));
  let reach: (typeof valid)[number] | null = null;
  for (const r of valid) {
    if (reach && r.offset < reach.endOffset) {
      const ovEnd = r.endOffset < reach.endOffset ? r.endOffset : reach.endOffset;
      add('error', 'ram-overlap', `RAM "${r.name}" overlaps "${reach.name}": ${formatAddr(ram.start + r.offset)}–${formatAddr(ram.start + ovEnd - 1n)} (${hexKb(ovEnd - r.offset)}). To share RAM, assign both partitions to the same region instead.`, undefined, r.id);
    }
    if (!reach || r.endOffset > reach.endOffset) reach = r;
  }
  for (const sg of ram.segments) {
    if (sg.kind === 'gap') add('warning', 'ram-gap', `RAM gap of ${hexKb(sg.endOffset - sg.offset)}: ${formatAddr(ram.start + sg.offset)}–${formatAddr(ram.start + sg.endOffset - 1n)}`);
  }
  if (total > 0n) add('info', 'ram-unused', `${ram.unused} bytes RAM unused = ${hexKb(ram.unused)}`);

  // partitions → regions
  const byId = new Map(ram.split.map((r) => [r.id, r]));
  const hasMain = ram.split.some((r) => !r.noinit);
  for (const p of config.partitions) {
    const label = p.name.trim() || 'partition';
    if (p.ram) {
      const r = byId.get(p.ram);
      if (!r) add('error', 'ram-ref-missing', `${label}: assigned RAM region no longer exists`, p.id);
      else if (r.noinit) add('error', 'ram-ref-noinit', `${label}: cannot use the shared no-init region "${r.name}" as its main RAM`, p.id);
    } else if (!hasMain) {
      add('error', 'ram-ref-none', `${label}: no normal RAM region to use`, p.id);
    }
  }
}

export const hasErrors = (issues: Issue[]): boolean => issues.some((i) => i.severity === 'error');
