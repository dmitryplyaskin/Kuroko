export const toolIds = ['roll_dice', 'resolveCheck', 'getRollDetails', 'test_echo'] as const;
export const toolPresetNameLimit = 120;

export type ToolId = (typeof toolIds)[number];
export type ToolPreset = { id: string; name: string; enabled: ToolId[] };
export type ToolsResponse = { enabled: ToolId[]; presets?: ToolPreset[] };

export function isToolId(value: unknown): value is ToolId {
  return toolIds.some((id) => id === value);
}

export function isToolSelection(value: unknown): value is ToolId[] {
  return Array.isArray(value) && value.length <= toolIds.length && value.every(isToolId) && new Set(value).size === value.length;
}

export function readToolPresetName(value: unknown) {
  if (typeof value !== 'string') return;
  const name = value.trim();
  if (name && name.length <= toolPresetNameLimit && name.isWellFormed() && !/[\p{Cc}]/u.test(name)) return name;
}
