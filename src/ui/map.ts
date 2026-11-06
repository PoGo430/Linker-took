import type { Layout, ResolvedPartition, ResolvedRamRegion, Segment } from '../core/layout';
import type { Issue } from '../core/validate';
import { formatAddr, formatHex, formatKb } from '../core/units';
import { h } from './dom';

export interface MapOptions {
  L: Layout;
  issues: Issue[];
  onResize(id: string, newSize: bigint): void;
  onReorder(id: string, toIndex: number): void;
  onSelect(id: string): void;
}

/** One block on a track (a flash partition or a RAM region). */
export interface TrackItem {
  id: string;
  /** Position in the owning list (used for reordering). */
  index: number;
  name: string;
  offset: bigint;
  size: bigint;
  color: string;
  bad: boolean;
  tag?: string;
  tip: string;
  aria: string;
}

export interface TrackSpec {
  label: string;
  /** Absolute address of offset 0. */
  start: bigint;
  total: bigint;
  items: TrackItem[];
  segments: Segment[];
  interactive: boolean;
  /** Snap granularity for resizing (page size for flash, user step for RAM). */
  step: bigint;
  onResize?(id: string, newSize: bigint): void;
  onReorder?(id: string, toIndex: number): void;
  onSelect?(id: string): void;
}

const tip = () => document.getElementById('tooltip') as HTMLElement;

function showTip(text: string, x: number, y: number) {
  const t = tip();
  t.textContent = text;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = `${Math.max(4, Math.min(x + 14, window.innerWidth - r.width - 4))}px`;
  t.style.top = `${y + 18 + r.height > window.innerHeight ? Math.max(4, y - r.height - 12) : y + 18}px`;
}
const hideTip = () => { tip().hidden = true; };

/** Black or white, whichever reads better on the given #rrggbb colour. */
function contrast(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.58 ? '#111' : '#fff';
}

const pct = (v: bigint, total: bigint): number => {
  if (total <= 0n) return 0;
  const c = v < 0n ? 0n : v > total ? total : v;
  return Number((c * 100000n) / total) / 1000;
};

function withTip(el: HTMLElement, text: () => string) {
  el.addEventListener('pointerenter', (e) => showTip(text(), e.clientX, e.clientY));
  el.addEventListener('pointermove', (e) => { if (!tip().hidden) showTip(text(), e.clientX, e.clientY); });
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); showTip(text(), r.left, r.bottom - 20); });
  el.addEventListener('blur', hideTip);
}

/** Replace the contents of `root` with the given tracks, keeping keyboard focus on the same handle/block. */
export function mountTracks(root: HTMLElement, specs: TrackSpec[], empty: string): void {
  const focused = (document.activeElement as HTMLElement | null)?.dataset;
  const inRoot = root.contains(document.activeElement);
  const refocus = !inRoot ? null : focused?.handle ? `[data-handle="${CSS.escape(focused.handle)}"]` : focused?.block ? `[data-block="${CSS.escape(focused.block)}"]` : null;
  hideTip();
  root.replaceChildren();
  if (!specs.length || specs[0].total <= 0n) {
    root.append(h('p', { class: 'muted' }, empty));
    return;
  }
  for (const spec of specs) root.append(renderTrack(spec));
  if (refocus) root.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
}

function segTip(s: Segment, start: bigint, what: string): string {
  const size = s.endOffset - s.offset;
  return [
    s.kind === 'gap' ? `Gap between ${what}` : 'Free space',
    `start  ${formatAddr(start + s.offset)}`,
    `end    ${formatAddr(start + s.endOffset - 1n)}  (last byte)`,
    `size   ${formatHex(size)}  (${formatKb(size)})`,
  ].join('\n');
}

function renderTrack(spec: TrackSpec): HTMLElement {
  const { start, total } = spec;
  const track = h('div', { class: 'track' });
  const wrap = h('div', { class: 'bank' },
    h('div', { class: 'bank-head' }, h('strong', {}, spec.label),
      h('span', { class: 'rng' }, `${formatAddr(start)} – ${formatAddr(start + total - 1n)} · ${formatHex(total)} (${formatKb(total)})`)),
    track,
    h('div', { class: 'axis' }, h('span', {}, formatAddr(start)), h('span', {}, formatAddr(start + total))));

  for (const s of spec.segments) {
    const el = h('div', { class: `seg ${s.kind}` }, h('span', {}, `${s.kind === 'gap' ? 'gap' : 'free'} ${formatKb(s.endOffset - s.offset)}`));
    el.style.left = `${pct(s.offset, total)}%`;
    el.style.width = `${pct(s.endOffset - s.offset, total)}%`;
    withTip(el, () => segTip(s, start, spec.interactive && spec.label.startsWith('RAM') ? 'RAM regions' : 'partitions'));
    track.append(el);
  }

  for (const it of spec.items) {
    if (it.size <= 0n) continue;
    const left = pct(it.offset, total);
    const right = pct(it.offset + it.size, total);
    const el = h('div', {
      class: `block${spec.interactive ? '' : ' ro-bank'}${it.bad ? ' bad' : ''}`,
      tabindex: 0, role: 'group', 'data-block': it.id, 'aria-label': it.aria,
    },
      h('span', { class: 'b-name' }, it.name || '(unnamed)'),
      h('span', { class: 'b-meta addr' }, `${formatAddr(start + it.offset)}–${formatAddr(start + it.offset + it.size - 1n)}`),
      h('span', { class: 'b-meta' }, `${formatHex(it.size)} · ${formatKb(it.size)}`),
      it.tag && h('span', { class: 'b-tag' }, it.tag));
    el.style.left = `${left}%`;
    el.style.width = `${Math.max(right - left, 0.3)}%`;
    el.style.background = it.color;
    el.style.color = contrast(it.color);
    withTip(el, () => it.tip);
    if (spec.interactive) wireBlock(el, it, track, spec);
    track.append(el);
  }
  return wrap;
}

function wireBlock(el: HTMLElement, p: TrackItem, track: HTMLElement, spec: TrackSpec) {
  const total = spec.total;

  // --- resize handle (end edge) ---
  const page = spec.step > 0n ? spec.step : 1n;
  // Gestures snap to the step and never push the item past the end of the track.
  const maxSize = total - p.offset;
  const snap = (v: bigint) => {
    const s = ((v + page / 2n) / page) * page;
    const lo = s < page ? page : s;
    return maxSize >= page && lo > maxSize ? maxSize : lo;
  };
  const handle = h('div', {
    class: 'handle', role: 'slider', tabindex: 0, 'data-handle': p.id,
    'aria-label': `Resize ${p.name}`,
    'aria-orientation': 'horizontal',
    'aria-valuemin': 0, 'aria-valuemax': Number(total), 'aria-valuenow': Number(p.size),
    'aria-valuetext': `${formatHex(p.size)}, ${formatKb(p.size)}`,
  });
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging…
    e.stopPropagation();
    handle.focus({ preventScroll: true }); // …but move focus here so any edited input stops being "in use"
    const x0 = e.clientX;
    const w = track.getBoundingClientRect().width || 1;
    const size0 = p.size;
    let last = p.size;
    const move = (ev: PointerEvent) => {
      const delta = BigInt(Math.round(((ev.clientX - x0) / w) * Number(total)));
      const next = snap(size0 + delta);
      if (next !== last) { last = next; spec.onResize?.(p.id, next); }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', (e) => {
    const stepBy = page * (e.shiftKey ? 10n : 1n);
    let next: bigint | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = p.size + stepBy;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = p.size - stepBy;
    else if (e.key === 'Home') next = page;
    else if (e.key === 'End') next = total - p.offset;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    next = snap(next);
    if (next !== p.size) spec.onResize?.(p.id, next);
  });
  handle.addEventListener('pointerenter', hideTip);
  el.append(handle);

  // --- reorder by dragging the block body ---
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target === handle) return;
    const x0 = e.clientX;
    let dragging = false;
    let line: HTMLElement | null = null;
    const rect = () => track.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - x0) > 6) {
        dragging = true;
        hideTip();
        el.classList.add('dragging');
        line = h('div', { class: 'dropline' });
        track.append(line);
      }
      if (dragging && line) line.style.left = `${Math.max(0, Math.min(ev.clientX - rect().left, rect().width)) - 1}px`;
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (dragging) {
        line?.remove();
        el.classList.remove('dragging');
        if (ev.type === 'pointerup') {
          // Insert after the highest-indexed item whose centre lies left of the pointer.
          const others = spec.items.filter((q) => q.id !== p.id);
          const at = ((ev.clientX - rect().left) / (rect().width || 1)) * Number(total);
          let idx = 0;
          others.forEach((q, i) => { if (q.size > 0n && Number(q.offset + q.size / 2n) < at) idx = i + 1; });
          if (idx !== p.index) spec.onReorder?.(p.id, idx);
        }
      } else if (ev.type === 'pointerup') {
        spec.onSelect?.(p.id);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const to = p.index + (e.key === 'ArrowRight' ? 1 : -1);
      if (to >= 0 && to < spec.items.length) spec.onReorder?.(p.id, to);
    } else if (e.key === 'Enter') spec.onSelect?.(p.id);
  });
}

// ---------------------------------------------------------------- flash

function partTip(p: ResolvedPartition, bankStart: bigint, L: Layout, bank: number): string {
  const start = bankStart + p.offset;
  const lines = [
    `${p.name}${L.dual ? (p.kind === 'shared' ? '  [identical in both banks]' : '  [update target]') : ''}`,
    `start  ${formatAddr(start)}`,
    `end    ${formatAddr(start + p.size - 1n)}  (last byte)`,
    `end    ${formatAddr(start + p.size)}  (exclusive)`,
    `size   ${formatHex(p.size)}  (${formatKb(p.size)}, ${p.size} bytes)`,
    `offset ${formatHex(p.offset)} from ${L.dual ? 'bank' : 'region'} start`,
  ];
  if (L.dual) lines.push(`bank ${bank + 1}${bank === 0 ? ' — linker scripts use these addresses' : ' (inactive/mirror)'}`);
  return lines.join('\n');
}

export function renderMap(root: HTMLElement, o: MapOptions): void {
  const { L } = o;
  const bad = new Set(o.issues.filter((i) => i.severity === 'error' && i.partitionId).map((i) => i.partitionId!));
  const specs: TrackSpec[] = L.bankStarts.map((bankStart, bank) => {
    const interactive = bank === 0;
    return {
      label: L.dual
        ? `Bank ${bank + 1} — ${interactive ? 'active · linker scripts use these addresses' : 'inactive · update target addresses'}`
        : 'Region',
      start: bankStart,
      total: L.bankSize,
      segments: L.segments,
      interactive,
      step: L.page,
      onResize: o.onResize,
      onReorder: o.onReorder,
      onSelect: o.onSelect,
      items: L.partitions.map((p) => ({
        id: p.id, index: p.index, name: p.name, offset: p.offset, size: p.sizeError ? 0n : p.size, color: p.color, bad: bad.has(p.id),
        tag: L.dual ? (p.kind === 'shared' ? '⇄ identical' : '↻ update target') : undefined,
        tip: partTip(p, bankStart, L, bank),
        aria: `${p.name}: ${formatAddr(bankStart + p.offset)} to ${formatAddr(bankStart + p.endOffset - 1n)}, ${formatKb(p.size)}${L.dual ? (p.kind === 'shared' ? ', identical in both banks' : ', update target') : ''}`,
      })),
    };
  });
  mountTracks(root, specs, 'Enter a valid region size to see the memory map.');
}

// ---------------------------------------------------------------- RAM

function ramTip(r: ResolvedRamRegion, users: string[]): string {
  return [
    `${r.name}${r.noinit ? '  [shared no-init]' : ''}`,
    `start  ${formatAddr(r.start)}`,
    `end    ${formatAddr(r.end - 1n)}  (last byte)`,
    `end    ${formatAddr(r.end)}  (exclusive)`,
    `size   ${formatHex(r.size)}  (${formatKb(r.size)}, ${r.size} bytes)`,
    `offset ${formatHex(r.offset)} from RAM start`,
    r.noinit ? 'emitted as RAM_NOINIT in every linker script' : `used by: ${users.length ? users.join(', ') : '(nothing — default for unassigned partitions if first)'}`,
  ].join('\n');
}

export interface RamMapOptions {
  L: Layout;
  /** partition id → ram region id (as configured). */
  assignments: Map<string, string>;
  partitionNames: Map<string, string>;
  issues: Issue[];
  onResize(id: string, newSize: bigint): void;
  onReorder(id: string, toIndex: number): void;
  onSelect(id: string): void;
}

export function renderRamMap(root: HTMLElement, o: RamMapOptions): void {
  const ram = o.L.ram;
  if (!ram || !ram.split.length) {
    root.replaceChildren();
    return;
  }
  const bad = new Set(o.issues.filter((i) => i.severity === 'error' && i.ramId).map((i) => i.ramId!));
  const firstMain = ram.split.find((r) => !r.noinit);
  const usersOf = (r: ResolvedRamRegion) => {
    const names = [...o.assignments].filter(([, rid]) => rid === r.id).map(([pid]) => o.partitionNames.get(pid) ?? pid);
    if (firstMain?.id === r.id) for (const [pid, n] of o.partitionNames) if (!o.assignments.get(pid)) names.push(n);
    return names;
  };
  mountTracks(root, [{
    label: 'RAM',
    start: ram.start,
    total: ram.size,
    segments: ram.segments,
    interactive: true,
    step: ram.step,
    onResize: o.onResize,
    onReorder: o.onReorder,
    onSelect: o.onSelect,
    items: ram.split.map((r) => ({
      id: r.id, index: r.index, name: r.name, offset: r.offset, size: r.sizeError ? 0n : r.size, color: r.color, bad: bad.has(r.id),
      tag: r.noinit ? '⚑ no-init' : undefined,
      tip: ramTip(r, usersOf(r)),
      aria: `RAM region ${r.name}: ${formatAddr(r.start)} to ${formatAddr(r.end - 1n)}, ${formatKb(r.size)}${r.noinit ? ', shared no-init' : ''}`,
    })),
  }], 'Enter a valid RAM size to see the RAM map.');
}
