import type { Preset } from './presets';
import type { ConnectionPreset } from './connectionSettings';
import type { ChatActivityEntry, ChatToolCall } from './chat';
import type { LlmErrorBody } from './llm';

export const agentToolIds = ['roll_dice', 'resolveCheck', 'getRollDetails', 'test_echo'] as const;
export const toolIds = [...agentToolIds, 'subagent'] as const;

export type AgentToolId = (typeof agentToolIds)[number];
export type ToolId = (typeof toolIds)[number];
export type ToolPreset = Preset & { enabled: ToolId[] };
export type ToolsResponse = {
  enabled: ToolId[];
  presets?: ToolPreset[];
  activePresetId?: string;
  temporaryAgentTools?: AgentToolId[];
  subagent?: {
    presetId: string | null;
    presets: Pick<ConnectionPreset, 'id' | 'name' | 'model' | 'provider'>[];
  };
};

export const delegatedTaskLimit = 16_000;
export const subagentNameLimit = 64;
export const delegatedAnswerLimit = 32_000;
export const subagentHistoryLimit = 12;
export const subagentHistoryTextLimit = 64_000;

export type DelegateTaskInput = { task: string; name?: string; agentId?: string };
export type SubagentTurn = { task: string; answer: string };
export type DelegateTaskRequest = DelegateTaskInput & { history?: SubagentTurn[] };
export type DelegateTaskResult = (
  { result: { answer: string; name?: string; rollIds?: string[] }; isError?: never } | { result: string; isError: true }
) & { toolCalls?: ChatToolCall[] };
export type DelegateTaskEvent =
  | { type: 'activity'; entry: ChatActivityEntry }
  | { type: 'done'; result: DelegateTaskResult }
  | ({ type: 'error' } & LlmErrorBody);

export function readDelegatedTask(value: unknown) {
  if (typeof value !== 'string' || value.length > delegatedTaskLimit * 2 || !value.isWellFormed() ||
    Array.from(value).length > delegatedTaskLimit) return;
  return value.trim() || undefined;
}

export function readSubagentName(value: unknown) {
  if (typeof value !== 'string' || value.length > subagentNameLimit * 2 || !value.isWellFormed() || /\p{Cc}/u.test(value)) return;
  const name = value.trim().normalize();
  if (name && Array.from(name).length <= subagentNameLimit) return name;
}

export function readSubagentResultName(result: DelegateTaskResult['result'] | ChatToolCall['result']) {
  if (result && typeof result === 'object' && !Array.isArray(result)) return readSubagentName(result.name);
}

export function isToolId(value: unknown): value is ToolId {
  return toolIds.some((id) => id === value);
}

export function isAgentToolId(value: unknown): value is AgentToolId {
  return agentToolIds.some((id) => id === value);
}

export function isAgentToolSelection(value: unknown): value is AgentToolId[] {
  return Array.isArray(value) && value.length <= agentToolIds.length && value.every(isAgentToolId) && new Set(value).size === value.length;
}

export function isSubagentTool(value: unknown) {
  return value === 'subagent' || value === 'delegate_task';
}

export function isToolSelection(value: unknown): value is ToolId[] {
  return Array.isArray(value) && value.length <= toolIds.length && value.every(isToolId) && new Set(value).size === value.length;
}
