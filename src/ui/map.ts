import type { Layout, ResolvedPartition, Segment } from '../core/layout';
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

function segTip(s: Segment, bankStart: bigint): string {
  const size = s.endOffset - s.offset;
  return [
    s.kind === 'gap' ? 'Gap between partitions' : 'Free space',
    `start  ${formatAddr(bankStart + s.offset)}`,
    `end    ${formatAddr(bankStart + s.endOffset - 1n)}  (last byte)`,
    `size   ${formatHex(size)}  (${formatKb(size)})`,
  ].join('\n');
}

export function renderMap(root: HTMLElement, o: MapOptions): void {
  const { L } = o;
  const focused = (document.activeElement as HTMLElement | null)?.dataset;
  const refocus = focused?.handle ? `[data-handle="${CSS.escape(focused.handle)}"]` : focused?.block ? `[data-block="${CSS.escape(focused.block)}"]` : null;
  hideTip();
  root.replaceChildren();
  if (L.bankSize <= 0n) {
    root.append(h('p', { class: 'muted' }, 'Enter a valid region size to see the memory map.'));
    return;
  }
  const bad = new Set(o.issues.filter((i) => i.severity === 'error' && i.partitionId).map((i) => i.partitionId!));
  for (let bank = 0; bank < L.bankStarts.length; bank++) root.append(renderBank(bank, o, bad));
  if (refocus) root.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
}

function renderBank(bank: number, o: MapOptions, bad: Set<string>): HTMLElement {
  const { L } = o;
  const bankStart = L.bankStarts[bank];
  const interactive = bank === 0;
  const track = h('div', { class: 'track' });

  const label = L.dual
    ? `Bank ${bank + 1} — ${interactive ? 'active · linker scripts use these addresses' : 'inactive · update target addresses'}`
    : 'Region';
  const wrap = h('div', { class: 'bank' },
    h('div', { class: 'bank-head' }, h('strong', {}, label),
      h('span', { class: 'rng' }, `${formatAddr(bankStart)} – ${formatAddr(bankStart + L.bankSize - 1n)} · ${formatHex(L.bankSize)} (${formatKb(L.bankSize)})`)),
    track,
    h('div', { class: 'axis' }, h('span', {}, formatAddr(bankStart)), h('span', {}, formatAddr(bankStart + L.bankSize))));

  for (const s of L.segments) {
    const el = h('div', { class: `seg ${s.kind}` }, h('span', {}, `${s.kind === 'gap' ? 'gap' : 'free'} ${formatKb(s.endOffset - s.offset)}`));
    el.style.left = `${pct(s.offset, L.bankSize)}%`;
    el.style.width = `${pct(s.endOffset - s.offset, L.bankSize)}%`;
    withTip(el, () => segTip(s, bankStart));
    track.append(el);
  }

  for (const p of L.partitions) {
    if (p.size <= 0n || p.sizeError) continue;
    const left = pct(p.offset, L.bankSize);
    const right = pct(p.endOffset, L.bankSize);
    const el = h('div', {
      class: `block${interactive ? '' : ' ro-bank'}${bad.has(p.id) ? ' bad' : ''}`,
      tabindex: 0, role: 'group', 'data-block': p.id,
      'aria-label': `${p.name}: ${formatAddr(bankStart + p.offset)} to ${formatAddr(bankStart + p.endOffset - 1n)}, ${formatKb(p.size)}${L.dual ? (p.kind === 'shared' ? ', identical in both banks' : ', update target') : ''}`,
    },
      h('span', { class: 'b-name' }, p.name || '(unnamed)'),
      h('span', { class: 'b-meta addr' }, `${formatAddr(bankStart + p.offset)}–${formatAddr(bankStart + p.endOffset - 1n)}`),
      h('span', { class: 'b-meta' }, `${formatHex(p.size)} · ${formatKb(p.size)}`),
      L.dual && h('span', { class: 'b-tag' }, p.kind === 'shared' ? '⇄ identical' : '↻ update target'));
    el.style.left = `${left}%`;
    el.style.width = `${Math.max(right - left, 0.3)}%`;
    el.style.background = p.color;
    el.style.color = contrast(p.color);
    withTip(el, () => partTip(p, bankStart, L, bank));
    if (interactive) wireBlock(el, p, track, o);
    track.append(el);
  }
  return wrap;
}

function wireBlock(el: HTMLElement, p: ResolvedPartition, track: HTMLElement, o: MapOptions) {
  const { L } = o;

  // --- resize handle (end edge) ---
  const page = L.page > 0n ? L.page : 1n;
  // Gestures snap to the page size and never push the partition past the end of the bank.
  const maxSize = L.bankSize - p.offset;
  const snap = (v: bigint) => {
    const s = ((v + page / 2n) / page) * page;
    const lo = s < page ? page : s;
    return maxSize >= page && lo > maxSize ? maxSize : lo;
  };
  const handle = h('div', {
    class: 'handle', role: 'slider', tabindex: 0, 'data-handle': p.id,
    'aria-label': `Resize ${p.name}`,
    'aria-orientation': 'horizontal',
    'aria-valuemin': 0, 'aria-valuemax': Number(L.bankSize), 'aria-valuenow': Number(p.size),
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
    const move = (ev: PointerEvent) => {
      const delta = BigInt(Math.round(((ev.clientX - x0) / w) * Number(L.bankSize)));
      const next = snap(size0 + delta);
      if (next !== p.size) o.onResize(p.id, next);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', (e) => {
    const step = page * (e.shiftKey ? 10n : 1n);
    let next: bigint | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = p.size + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = p.size - step;
    else if (e.key === 'Home') next = page;
    else if (e.key === 'End') next = L.bankSize - p.offset;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    next = snap(next);
    if (next !== p.size) o.onResize(p.id, next);
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
          // Insert after the highest-indexed partition whose centre lies left of the pointer.
          const others = L.partitions.filter((q) => q.id !== p.id);
          const at = ((ev.clientX - rect().left) / (rect().width || 1)) * Number(L.bankSize);
          let idx = 0;
          others.forEach((q, i) => { if (q.size > 0n && Number(q.offset + q.size / 2n) < at) idx = i + 1; });
          if (idx !== p.index) o.onReorder(p.id, idx);
        }
      } else if (ev.type === 'pointerup') {
        o.onSelect(p.id);
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
      if (to >= 0 && to < L.partitions.length) o.onReorder(p.id, to);
    } else if (e.key === 'Enter') o.onSelect(p.id);
  });
}
