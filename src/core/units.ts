/** Integer-only parsing and formatting of sizes/addresses (BigInt, never floats). */

export type ParseResult = { ok: true; value: bigint } | { ok: false; error: string };

const MULT: Record<string, bigint> = { k: 1024n, m: 1024n * 1024n, g: 1024n * 1024n * 1024n };

// [sign] number [unit]   number = 0xHEX | decimal | decimal.fraction ; unit = K|M|G (+ optional B / iB) or plain B
const RE = /^([+-])?\s*(0x[0-9a-f_]+|\d[\d_]*(?:\.\d+)?|\.\d+)\s*(?:([kmg])(?:i?b)?|b)?$/i;

const fail = (error: string): ParseResult => ({ ok: false, error });

/**
 * Parse "0x8000", "32768", "32K", "1.5K", "1M", "0x2K", "-4K".
 * K/M/G are binary multiples (1024). Fractions are allowed only if the result is whole bytes.
 */
export function parseValue(input: string): ParseResult {
  const s = input.trim();
  if (!s) return fail('Value is empty');
  const m = RE.exec(s);
  if (!m) return fail(`Cannot parse "${s}" (use 0x…, decimal, or a K/M suffix)`);
  const [, sign, num, unit] = m;
  const mult = unit ? MULT[unit.toLowerCase()] : 1n;
  let value: bigint;
  try {
    if (/^0x/i.test(num)) {
      value = BigInt(num.replace(/_/g, '')) * mult;
    } else {
      const [i = '', f = ''] = num.replace(/_/g, '').split('.');
      const scale = 10n ** BigInt(f.length);
      const numer = (BigInt(i || '0') * scale + BigInt(f || '0')) * mult;
      if (numer % scale !== 0n) return fail(`"${s}" is not a whole number of bytes`);
      value = numer / scale;
    }
  } catch {
    return fail(`Cannot parse "${s}"`);
  }
  return { ok: true, value: sign === '-' ? -value : value };
}

/** "0x8000"; negative values as "-0x8000". Upper-case digits. */
export function formatHex(v: bigint, minDigits = 1): string {
  const neg = v < 0n;
  const digits = (neg ? -v : v).toString(16).toUpperCase().padStart(minDigits, '0');
  return `${neg ? '-' : ''}0x${digits}`;
}

/** Address: padded to at least 8 hex digits (32-bit), e.g. 0x08000000. */
export const formatAddr = (v: bigint): string => formatHex(v, 8);

/** "32 kB", "1 kB + 12 B", "12 B" — exact, so off-by-a-few-bytes errors are visible. */
export function formatKb(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const kb = a / 1024n;
  const rem = a % 1024n;
  let s: string;
  if (rem === 0n) s = `${kb} kB`;
  else if (kb === 0n) s = `${rem} B`;
  else s = `${kb} kB + ${rem} B`;
  return neg ? `-${s}` : s;
}

/** "0x8000 (32 kB)" */
export const hexKb = (v: bigint): string => `${formatHex(v)} (${formatKb(v)})`;
export const addrKb = (v: bigint): string => `${formatAddr(v)}`;
