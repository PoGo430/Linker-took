import type { Layout } from '../core/layout';
import type { Issue } from '../core/validate';
import { formatAddr, formatHex, formatKb } from '../core/units';
import { h } from './dom';

const SEV_LABEL = { error: 'Error', warning: 'Warn', info: 'Info' } as const;

export function renderIssues(ul: HTMLElement, issues: Issue[]): void {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const real = sorted.filter((i) => i.severity !== 'info');
  const items = sorted.map((i) => h('li', { class: i.severity }, h('span', { class: 'sev' }, SEV_LABEL[i.severity]), h('span', {}, i.message)));
  if (!real.length) items.unshift(h('li', { class: 'ok' }, h('span', { class: 'sev' }, 'OK'), h('span', {}, 'No errors or warnings.')));
  ul.replaceChildren(...items);
}

const stat = (k: string, v: string) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));

export function renderStats(el: HTMLElement, L: Layout, issues: Issue[]): void {
  const errs = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warning').length;
  const kids = [stat('Region', `${formatHex(L.regionSize)} · ${formatKb(L.regionSize)}`)];
  if (L.dual) kids.push(stat('Per bank', `${formatHex(L.bankSize)} · ${formatKb(L.bankSize)}`));
  kids.push(
    stat(L.dual ? 'Used per bank' : 'Used', `${formatHex(L.usedPerBank)} · ${formatKb(L.usedPerBank)}`),
    stat(L.dual ? 'Unused per bank' : 'Unused', `${L.unusedPerBank} B · ${formatHex(L.unusedPerBank)} · ${formatKb(L.unusedPerBank)}`),
    stat('Errors / warnings', `${errs} / ${warns}`),
  );
  el.replaceChildren(...kids);
}

export function renderSummary(table: HTMLElement, L: Layout): void {
  const th = (t: string) => h('th', { scope: 'col' }, t);
  const td = (t: string, cls = 'mono') => h('td', { class: cls }, t);
  const head = ['Partition', ...(L.dual ? ['Role'] : []), 'Start', 'Last byte', 'Size', ...(L.dual ? ['Inactive start', 'Inactive last byte'] : [])];
  const rows = L.partitions.map((p) => {
    const cells = [
      h('td', {}, h('span', { class: 'swatch', style: `background:${p.color}` }), p.name || '(unnamed)'),
      ...(L.dual ? [td(p.kind === 'shared' ? 'identical in both banks' : 'update target', '')] : []),
      td(formatAddr(p.start)),
      td(p.size > 0n ? formatAddr(p.end - 1n) : '—'),
      td(`${formatHex(p.size)} · ${formatKb(p.size)}`),
      ...(L.dual && p.inactiveStart !== null ? [td(formatAddr(p.inactiveStart)), td(p.size > 0n ? formatAddr(p.inactiveStart + p.size - 1n) : '—')] : []),
    ];
    return h('tr', {}, ...cells);
  });
  table.replaceChildren(
    h('thead', {}, h('tr', {}, ...head.map(th))),
    h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: head.length, class: '' }, 'No partitions yet.'))])),
  );
}
