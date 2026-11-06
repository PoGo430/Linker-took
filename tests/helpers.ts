import { emptyConfig, type Config, type PartitionInput } from '../src/core/model';
import { computeLayout } from '../src/core/layout';
import { validate } from '../src/core/validate';
import { PRESETS } from '../src/core/presets';

export const P = (name: string, size: string, extra: Partial<PartitionInput> = {}): PartitionInput => ({
  id: name, name, size, offset: '', fill: false, color: '#888888', kind: 'update', ram: '', ...extra,
});

export function cfg(partitions: PartitionInput[], over: Partial<Config> = {}): Config {
  return { ...emptyConfig(), ...over, partitions };
}

export const run = (c: Config) => {
  const L = computeLayout(c);
  return { L, issues: validate(c, L) };
};

export const dualPreset = () => PRESETS.find((p) => p.id === 'stm32c562re-dual')!.build();
export const codes = (c: Config, sev?: string) => run(c).issues.filter((i) => !sev || i.severity === sev).map((i) => i.code);
