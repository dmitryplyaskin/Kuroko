import { instructionTextLimit, isWorldBinding, readInstructionText } from './instructions';
import { isAgentToolSelection, readSubagentName, type AgentToolId } from './tools';

export type AgentDraft = { name: string; description: string; instructions: string; tools: AgentToolId[]; worldId?: string | null };
export type UpdateAgent = AgentDraft & { revision: number };
export type SavedAgent = UpdateAgent & { id: string; worldTitle?: string };
export type AgentSummary = Pick<SavedAgent, 'id' | 'name' | 'description'>;
export type AgentField = Exclude<keyof AgentDraft, 'worldId'>;

export const agentDescriptionLimit = 500;
export const agentInstructionsLimit = instructionTextLimit;

export function isAgentId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
}

export function isAgentRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readText(value: unknown, limit: number) {
  if (typeof value === 'string' && value.length <= limit && value.isWellFormed()) return value.trim() || undefined;
}

export function readAgent(value: unknown): { draft: AgentDraft } | { field: AgentField } {
  const input = value as Partial<Record<keyof AgentDraft, unknown>> | null | undefined;
  const name = readSubagentName(input?.name);
  if (!name) return { field: 'name' };
  const description = readText(input?.description, agentDescriptionLimit);
  if (!description) return { field: 'description' };
  const instructions = readInstructionText(input?.instructions);
  const worldId = input?.worldId;
  if (!instructions || !isWorldBinding(worldId)) return { field: 'instructions' };
  const tools: unknown = input?.tools;
  if (!isAgentToolSelection(tools)) return { field: 'tools' };
  return { draft: { name, description, instructions, tools, ...(worldId ? { worldId } : {}) } };
}
