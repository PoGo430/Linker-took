import { sanitizeConfig, type Config } from './model';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const serializeConfig = (c: Config): string => JSON.stringify(c, null, 2);

export function parseConfigJson(text: string): Config | null {
  try {
    return sanitizeConfig(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Compact encoding for the URL hash (`#c=…`). */
export function encodeConfig(c: Config): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(c)));
}

export function decodeConfig(s: string): Config | null {
  try {
    return parseConfigJson(new TextDecoder().decode(fromBase64Url(s)));
  } catch {
    return null;
  }
}

export const HASH_KEY = 'c=';

export function configFromHash(hash: string): Config | null {
  const h = hash.replace(/^#/, '');
  return h.startsWith(HASH_KEY) ? decodeConfig(h.slice(HASH_KEY.length)) : null;
}
export const hashFromConfig = (c: Config): string => `#${HASH_KEY}${encodeConfig(c)}`;
