import '../styles.css';
import { emptyConfig, newId, PALETTE, type Config, type PartitionInput } from '../core/model';
import { computeLayout, type Layout } from '../core/layout';
import { hasErrors, validate, type Issue } from '../core/validate';
import { generateAll, type OutFile } from '../core/ld';
import { formatAddr, formatHex, formatKb, hexKb, parseValue } from '../core/units';
import { PRESETS, defaultPreset } from '../core/presets';
import { configFromHash, hashFromConfig, parseConfigJson, serializeConfig } from '../core/share';
import { createZip } from '../core/zip';
import { highlight } from '../core/highlight';
import { $, copyText, download, h } from './dom';
import { renderMap } from './map';
import { renderIssues, renderStats, renderSummary } from './output';

const LS_CONFIG = 'lpp-config';
const LS_THEME = 'lpp-theme';

let config: Config = emptyConfig();
let L: Layout = computeLayout(config);
let issues: Issue[] = [];
let files: OutFile[] = [];
let selectedKey = '';
let baseline = '';
let hashTimer: number | undefined;
let statusTimer: number | undefined;

// ---------- helpers ----------
function getPath(path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], config);
}
function setPath(path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, config as unknown as Record<string, unknown>);
  target[last] = value;
}
function status(msg: string) {
  const el = $('#status');
  el.textContent = msg;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (el.textContent = ''), 3000);
}
/** Compact size text: "32K" when exact, else hex. */
const sizeText = (v: bigint): string => (v > 0n && v % 1024n === 0n ? `${v / 1024n}K` : formatHex(v));

function readoutText(path: string): { text: string; bad: boolean } {
  const raw = String(getPath(path) ?? '');
  const r = parseValue(raw);
  if (!r.ok) return { text: raw.trim() === '' && path === 'ram.reservedTop' ? '0 B' : r.error, bad: !(raw.trim() === '' && path === 'ram.reservedTop') };
  const isAddr = path.endsWith('.start');
  let text = isAddr ? `${formatAddr(r.value)} · ${r.value} dec` : `${formatHex(r.value)} · ${formatKb(r.value)}`;
  if (path === 'region.size' && config.dualBank) text += ` · bank ${hexKb(r.value / 2n)}`;
  return { text, bad: false };
}

// ---------- static field binding ----------
function bindStatic() {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-bind]').forEach((el) => {
    const v = getPath(el.dataset.bind!);
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v ?? '');
  });
}
function wireStatic() {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-bind]').forEach((el) => {
    const path = el.dataset.bind!;
    el.addEventListener('input', () => {
      setPath(path, el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value);
      recompute();
    });
  });
}

// ---------- partition rows ----------
const rowsEl = () => $('#rows');

function cell(label: string, ...kids: (Node | string)[]): HTMLElement {
  return h('div', { class: 'cell' }, h('span', { class: 'lbl' }, label), ...kids);
}

function buildRow(p: PartitionInput): HTMLElement {
  const color = h('input', { type: 'color', 'aria-label': `Colour of ${p.name}`, value: p.color });
  const name = h('input', { value: p.name, 'aria-label': 'Partition name', autocomplete: 'off', spellcheck: 'false', 'data-f': 'name' });
  const size = h('input', { value: p.size, 'aria-label': `Size of ${p.name}`, autocomplete: 'off', spellcheck: 'false', 'data-f': 'size' });
  const offset = h('input', { value: p.offset, placeholder: 'auto', 'aria-label': `Offset of ${p.name}`, autocomplete: 'off', spellcheck: 'false', 'data-f': 'offset' });
  const fill = h('input', { type: 'checkbox', 'aria-label': `Fill remaining space with ${p.name}`, 'data-f': 'fill' });
  const kind = h('select', { 'aria-label': `Role of ${p.name} in dual-bank mode`, 'data-f': 'kind' },
    h('option', { value: 'update' }, 'Update target'), h('option', { value: 'shared' }, 'Identical in both banks'));
  kind.value = p.kind;
  fill.checked = p.fill;

  const find = () => config.partitions.find((q) => q.id === p.id)!;
  color.addEventListener('input', () => { find().color = color.value; recompute(); });
  name.addEventListener('input', () => { find().name = name.value; recompute(); });
  size.addEventListener('input', () => { find().size = size.value; recompute(); });
  offset.addEventListener('input', () => { find().offset = offset.value; recompute(); });
  fill.addEventListener('change', () => { find().fill = fill.checked; recompute(); });
  kind.addEventListener('change', () => { find().kind = kind.value as PartitionInput['kind']; recompute(); });

  const move = (d: number) => () => {
    const i = config.partitions.findIndex((q) => q.id === p.id);
    reorder(p.id, i + d);
    rowsEl().querySelector<HTMLElement>(`[data-id="${CSS.escape(p.id)}"] [data-mv="${d}"]`)?.focus();
  };
  const up = h('button', { type: 'button', 'aria-label': `Move ${p.name} earlier`, 'data-mv': -1 }, '↑');
  const down = h('button', { type: 'button', 'aria-label': `Move ${p.name} later`, 'data-mv': 1 }, '↓');
  const del = h('button', { type: 'button', 'aria-label': `Remove ${p.name}`, title: 'Remove' }, '✕');
  up.addEventListener('click', move(-1));
  down.addEventListener('click', move(1));
  del.addEventListener('click', () => {
    config.partitions = config.partitions.filter((q) => q.id !== p.id);
    renderRows();
    recompute();
    $('#btn-add').focus();
  });

  return h('div', { class: 'prow', 'data-id': p.id, role: 'group', 'aria-label': `Partition ${p.name}` },
    h('div', { class: 'cell' }, h('span', { class: 'lbl' }, 'Colour'), color),
    cell('Name', name),
    cell('Size', size, h('span', { class: 'ro', 'data-ro': 'size' })),
    cell('Offset', offset, h('span', { class: 'ro', 'data-ro': 'offset' })),
    h('label', { class: 'fillc' }, fill, 'Fill'),
    h('div', { class: 'acts' }, up, down, del),
    h('div', { class: 'cell dual-only' }, h('span', { class: 'lbl' }, 'Dual-bank role'), kind, h('span', { class: 'ro', 'data-ro': 'range' })),
  );
}

function renderRows() {
  const host = rowsEl();
  if (!config.partitions.length) host.replaceChildren(h('div', { class: 'rows-empty' }, 'No partitions yet — add one.'));
  else host.replaceChildren(...config.partitions.map(buildRow));
}

/** Update derived readouts and (when not being edited) input values of every row. */
function syncRows() {
  const bad = new Map<string, 'error' | 'warning'>();
  for (const i of issues) {
    if (!i.partitionId || i.severity === 'info') continue;
    if (i.severity === 'error' || !bad.has(i.partitionId)) bad.set(i.partitionId, i.severity);
  }
  const n = config.partitions.length;
  config.partitions.forEach((p, idx) => {
    const row = rowsEl().querySelector<HTMLElement>(`[data-id="${CSS.escape(p.id)}"]`);
    const rp = L.partitions[idx];
    if (!row || !rp) return;
    const q = <T extends HTMLElement>(s: string) => row.querySelector<T>(s)!;
    const sizeIn = q<HTMLInputElement>('[data-f="size"]');
    const offIn = q<HTMLInputElement>('[data-f="offset"]');
    const fillIn = q<HTMLInputElement>('[data-f="fill"]');
    if (document.activeElement !== sizeIn && sizeIn.value !== p.size) sizeIn.value = p.size;
    if (document.activeElement !== offIn && offIn.value !== p.offset) offIn.value = p.offset;
    fillIn.checked = p.fill;
    fillIn.disabled = idx !== n - 1 && !p.fill;
    sizeIn.disabled = rp.fill;
    sizeIn.setAttribute('aria-invalid', String(Boolean(rp.sizeError)));
    offIn.setAttribute('aria-invalid', String(Boolean(rp.offsetError)));
    const so = q('[data-ro="size"]');
    so.textContent = rp.sizeError ? rp.sizeError : `${formatHex(rp.size)} · ${formatKb(rp.size)}`;
    so.classList.toggle('bad', Boolean(rp.sizeError) || rp.size <= 0n);
    const oo = q('[data-ro="offset"]');
    oo.textContent = rp.offsetError ? rp.offsetError : `${formatHex(rp.offset)} · ${formatKb(rp.offset)}${p.offset.trim() === '' ? ' (auto)' : ''}`;
    oo.classList.toggle('bad', Boolean(rp.offsetError));
    q('[data-ro="range"]').textContent = `${formatAddr(rp.start)} → ${rp.size > 0n ? formatAddr(rp.end - 1n) : '—'}`;
    const sev = bad.get(p.id);
    row.classList.toggle('has-error', sev === 'error');
    row.classList.toggle('has-warning', sev === 'warning');
  });
}

/** Move a partition to `toIndex` (index in the list after removal). Re-packs: fixed offsets are cleared. */
function reorder(id: string, toIndex: number) {
  const from = config.partitions.findIndex((q) => q.id === id);
  if (from < 0) return;
  const to = Math.max(0, Math.min(toIndex, config.partitions.length - 1));
  if (to === from) return;
  const [item] = config.partitions.splice(from, 1);
  config.partitions.splice(to, 0, item);
  for (const q of config.partitions) q.offset = '';
  // "Fill" is only valid on the last partition: freeze its current size if it stopped being last.
  const last = config.partitions[config.partitions.length - 1];
  for (const q of config.partitions) {
    if (q === last || !q.fill) continue;
    const rp = L.partitions.find((r) => r.id === q.id);
    q.fill = false;
    if (rp && rp.size > 0n) q.size = sizeText(rp.size);
  }
  renderRows();
  recompute();
}

function addPartition() {
  const prev = config.partitions[config.partitions.length - 1];
  if (prev?.fill) {
    const rp = L.partitions[L.partitions.length - 1];
    prev.fill = false;
    prev.size = rp && rp.size > 0n ? sizeText(rp.size) : prev.size;
  }
  const pg = parseValue(config.page);
  const n = config.partitions.length + 1;
  config.partitions.push({
    id: newId(),
    name: `part${n}`,
    size: pg.ok && pg.value > 0n ? sizeText(pg.value) : '8K',
    offset: '',
    fill: false,
    color: PALETTE[(n - 1) % PALETTE.length],
    kind: 'update',
  });
  renderRows();
  recompute();
  const rows = rowsEl().querySelectorAll<HTMLInputElement>('[data-f="name"]');
  const input = rows[rows.length - 1];
  input?.focus();
  input?.select();
}

// ---------- outputs ----------
function renderOutputs() {
  files = generateAll(config, L);
  if (!files.some((f) => f.key === selectedKey)) selectedKey = files[0]?.key ?? '';
  const tabs = $('#tabs');
  tabs.replaceChildren(
    ...files.map((f) =>
      h('button', {
        type: 'button', role: 'tab', 'data-key': f.key, id: `tab-${f.key}`,
        'aria-selected': String(f.key === selectedKey), tabindex: f.key === selectedKey ? 0 : -1,
      }, f.filename),
    ),
  );
  const cur = files.find((f) => f.key === selectedKey);
  const code = $('#code');
  code.innerHTML = cur ? highlight(cur.content) : '';
  code.setAttribute('aria-labelledby', cur ? `tab-${cur.key}` : '');
  $('#out-warning').hidden = !hasErrors(issues);
}

function selectTab(key: string, focus = false) {
  selectedKey = key;
  renderOutputs();
  if (focus) $<HTMLElement>(`#tabs [data-key="${CSS.escape(key)}"]`).focus();
}

function wireTabs() {
  const tabs = $('#tabs');
  tabs.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
    if (b) selectTab(b.dataset.key!);
  });
  tabs.addEventListener('keydown', (e) => {
    const i = files.findIndex((f) => f.key === selectedKey);
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % files.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + files.length) % files.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = files.length - 1;
    else return;
    e.preventDefault();
    if (files[j]) selectTab(files[j].key, true);
  });
  $('#btn-copy').addEventListener('click', async () => {
    const f = files.find((x) => x.key === selectedKey);
    if (f) status((await copyText(f.content)) ? `Copied ${f.filename}` : 'Copy failed — select the text manually');
  });
  $('#btn-dl').addEventListener('click', () => {
    const f = files.find((x) => x.key === selectedKey);
    if (f) download(f.filename, f.content);
  });
  $('#btn-zip').addEventListener('click', () => {
    const zip = createZip([...files.map((f) => ({ name: f.filename, data: f.content })), { name: 'partition-config.json', data: serializeConfig(config) }]);
    download('linker-scripts.zip', zip, 'application/zip');
    status(`Zipped ${files.length + 1} files`);
  });
}

// ---------- persistence ----------
function persist() {
  try { localStorage.setItem(LS_CONFIG, serializeConfig(config)); } catch { /* storage unavailable */ }
  window.clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    try { history.replaceState(null, '', hashFromConfig(config)); } catch { /* ignore */ }
  }, 250);
}

function setConfig(c: Config) {
  config = c;
  baseline = serializeConfig(config);
  bindStatic();
  renderRows();
  recompute();
}
const isModified = () => serializeConfig(config) !== baseline;

// ---------- main recompute ----------
function recompute() {
  L = computeLayout(config);
  issues = validate(config, L);
  document.body.dataset.dual = String(config.dualBank);
  document.querySelectorAll<HTMLElement>('[data-readout]').forEach((el) => {
    const { text, bad } = readoutText(el.dataset.readout!);
    el.textContent = text;
    el.classList.toggle('bad', bad);
  });
  document.querySelectorAll<HTMLInputElement>('[data-bind]').forEach((el) => {
    if (el.dataset.bind === 'region.name' || el.type === 'checkbox' || el.tagName === 'SELECT') return;
    const path = el.dataset.bind!;
    const r = parseValue(String(getPath(path)));
    el.setAttribute('aria-invalid', String(!r.ok && !(path === 'ram.reservedTop' && String(getPath(path)).trim() === '')));
  });
  syncRows();
  renderMap($('#map'), {
    L, issues,
    onResize(id, size) {
      const p = config.partitions.find((q) => q.id === id);
      if (!p) return;
      p.fill = false;
      p.size = sizeText(size);
      recompute();
    },
    onReorder: (id, idx) => reorder(id, idx),
    onSelect(id) {
      const input = rowsEl().querySelector<HTMLInputElement>(`[data-id="${CSS.escape(id)}"] [data-f="name"]`);
      input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      input?.focus({ preventScroll: true });
    },
  });
  renderStats($('#stats'), L, issues);
  renderIssues($('#issues'), issues);
  renderSummary($('#summary'), L);
  renderOutputs();
  persist();
}

// ---------- toolbar ----------
function wireToolbar() {
  const preset = $<HTMLSelectElement>('#preset');
  preset.append(h('option', { value: '' }, 'Load a preset…'), ...PRESETS.map((p) => h('option', { value: p.id }, p.label)));
  preset.addEventListener('change', () => {
    const p = PRESETS.find((x) => x.id === preset.value);
    preset.value = '';
    if (!p) return;
    if (isModified() && !window.confirm('Replace the current layout with this preset? Unsaved changes will be lost.')) return;
    setConfig(p.build());
  });
  $('#btn-add').addEventListener('click', addPartition);
  $('#btn-save').addEventListener('click', () => download('linker-partition-config.json', serializeConfig(config), 'application/json'));
  const file = $<HTMLInputElement>('#file-load');
  $('#btn-load').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    const c = parseConfigJson(await f.text());
    if (!c) return status('Not a valid configuration file');
    if (isModified() && !window.confirm('Replace the current layout with the loaded file?')) return;
    setConfig(c);
    status(`Loaded ${f.name}`);
  });
  $('#btn-link').addEventListener('click', async () => {
    try { history.replaceState(null, '', hashFromConfig(config)); } catch { /* ignore */ }
    status((await copyText(location.href)) ? 'Share link copied' : 'Copy failed — copy the address bar URL');
  });
  $('#btn-theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem(LS_THEME, root.dataset.theme); } catch { /* ignore */ }
  });
  window.addEventListener('hashchange', () => {
    const c = configFromHash(location.hash);
    if (c && serializeConfig(c) !== serializeConfig(config)) setConfig(c);
  });
}

function init() {
  wireStatic();
  wireTabs();
  wireToolbar();
  let initial: Config | null = configFromHash(location.hash);
  if (!initial) {
    try {
      const saved = localStorage.getItem(LS_CONFIG);
      if (saved) initial = parseConfigJson(saved);
    } catch { /* ignore */ }
  }
  setConfig(initial ?? defaultPreset());
}

init();
