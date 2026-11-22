export type Preset = { id: string; name: string };

export type PresetManagementAction =
  | { kind: 'apply' | 'delete'; id: string }
  | { kind: 'rename' | 'copy'; id: string; name: string };

export type PresetAction = PresetManagementAction
  | { kind: 'create'; name: string }
  | { kind: 'update'; id: string };

export const presetNameLimit = 120;

export function readPresetName(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const name = value.trim().normalize();
  if (name && name.length <= presetNameLimit && name.isWellFormed() && !/[\p{Cc}]/u.test(name)) return name;
}
