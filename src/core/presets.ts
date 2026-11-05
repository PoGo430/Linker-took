import { emptyConfig, type Config, type PartitionInput } from './model';

export interface Preset {
  id: string;
  label: string;
  build(): Config;
}

const part = (id: string, name: string, size: string, color: string, kind: 'shared' | 'update', extra: Partial<PartitionInput> = {}): PartitionInput => ({
  id, name, size, offset: '', fill: false, color, kind, ...extra,
});

export const PRESETS: Preset[] = [
  {
    id: 'stm32c562re-dual',
    label: 'STM32C562RE dual-bank (512K, 8K pages)',
    build: () => ({
      ...emptyConfig(),
      region: { name: 'FLASH', start: '0x08000000', size: '512K' },
      page: '0x2000',
      dualBank: true,
      partitions: [
        part('bootloader', 'bootloader', '24K', '#4c78a8', 'shared'),
        part('header', 'header', '8K', '#eeca3b', 'update'),
        part('app', 'app', '224K', '#54a24b', 'update'),
      ],
      ram: { enabled: true, start: '0x20000000', size: '128K', reservedTop: '0' },
    }),
  },
  {
    id: 'generic-single',
    label: 'Generic single-bank (256K, 2K pages)',
    build: () => ({
      ...emptyConfig(),
      region: { name: 'FLASH', start: '0x08000000', size: '256K' },
      page: '0x800',
      dualBank: false,
      partitions: [
        part('bootloader', 'bootloader', '16K', '#4c78a8', 'shared'),
        part('app', 'app', '0', '#54a24b', 'update', { fill: true }),
      ],
      ram: { enabled: true, start: '0x20000000', size: '64K', reservedTop: '0' },
    }),
  },
  { id: 'empty', label: 'Empty layout', build: () => emptyConfig() },
];

export const defaultPreset = (): Config => PRESETS[0].build();
