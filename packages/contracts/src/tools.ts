export const toolIds = ['roll_dice', 'test_echo'] as const;

export type ToolId = (typeof toolIds)[number];
export type ToolsResponse = { enabled: ToolId[] };

export function isToolId(value: unknown): value is ToolId {
  return toolIds.some((id) => id === value);
}
