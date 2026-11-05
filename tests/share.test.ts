import { describe, expect, it } from 'vitest';
import { configFromHash, decodeConfig, encodeConfig, hashFromConfig, parseConfigJson, serializeConfig } from '../src/core/share';
import { sanitizeConfig } from '../src/core/model';
import { dualPreset } from './helpers';

describe('persistence', () => {
  it('round-trips through JSON', () => {
    const c = dualPreset();
    expect(parseConfigJson(serializeConfig(c))).toEqual(c);
  });
  it('round-trips through the URL hash, including unicode', () => {
    const c = dualPreset();
    c.partitions[0].name = 'böotloader ✓';
    expect(decodeConfig(encodeConfig(c))).toEqual(c);
    expect(configFromHash(hashFromConfig(c))).toEqual(c);
    expect(hashFromConfig(c)).toMatch(/^#c=[A-Za-z0-9_-]+$/);
  });
  it('rejects garbage', () => {
    expect(decodeConfig('%%%')).toBeNull();
    expect(parseConfigJson('not json')).toBeNull();
    expect(parseConfigJson('[]')).toBeNull();
    expect(configFromHash('#other')).toBeNull();
  });
  it('sanitises hostile or partial input', () => {
    const c = sanitizeConfig({ region: { size: 5 }, partitions: [{ name: 7, color: 'red', kind: 'x' }, { id: 'a' }, { id: 'a' }] })!;
    expect(c.region.size).toBe('5');
    expect(c.partitions[0].color).toMatch(/^#/);
    expect(c.partitions[0].kind).toBe('update');
    expect(new Set(c.partitions.map((p) => p.id)).size).toBe(3);
  });
});
