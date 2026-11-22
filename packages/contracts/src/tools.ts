import type { Preset } from './presets';

export const toolIds = ['roll_dice', 'resolveCheck', 'getRollDetails', 'test_echo'] as const;

export type ToolId = (typeof toolIds)[number];
export type ToolPreset = Preset & { enabled: ToolId[] };
export type ToolsResponse = { enabled: ToolId[]; presets?: ToolPreset[]; activePresetId?: string };

export function isToolId(value: unknown): value is ToolId {
  return toolIds.some((id) => id === value);
}

export function isToolSelection(value: unknown): value is ToolId[] {
  return Array.isArray(value) && value.length <= toolIds.length && value.every(isToolId) && new Set(value).size === value.length;
}
