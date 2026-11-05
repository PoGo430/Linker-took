const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const KEYWORDS = /^(MEMORY|SECTIONS|ENTRY|PROVIDE|PROVIDE_HIDDEN|KEEP|ALIGN|ORIGIN|LENGTH|LOADADDR|SORT|AT|NOLOAD|READONLY|COMMON|org|len|ROM|RAM|RAM_NOINIT|include|define|ifndef|endif|if|else)$/;

// comment | preprocessor | hex | number | identifier
const TOKEN = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(#\s*\w+)|(\b0[xX][0-9a-fA-F]+(?:UL)?\b)|(\b\d+\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

/** Tiny dependency-free highlighter for linker scripts and C headers → HTML. */
export function highlight(code: string): string {
  let out = '';
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    out += esc(code.slice(last, i));
    last = i + m[0].length;
    const t = esc(m[0]);
    if (m[1] !== undefined) out += `<span class="tok-c">${t}</span>`;
    else if (m[2] !== undefined) out += `<span class="tok-k">${t}</span>`;
    else if (m[3] !== undefined || m[4] !== undefined) out += `<span class="tok-n">${t}</span>`;
    else if (KEYWORDS.test(m[5])) out += `<span class="tok-k">${t}</span>`;
    else if (/^(_[A-Za-z0-9_]+|PART_\w+|[A-Z0-9_]{3,})$/.test(m[5])) out += `<span class="tok-s">${t}</span>`;
    else out += t;
  }
  return out + esc(code.slice(last));
}
