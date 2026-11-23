import { isAgentToolSelection, readSubagentName, type AgentToolId } from './tools';

export type AgentDraft = { name: string; description: string; instructions: string; tools: AgentToolId[] };
export type SavedAgent = AgentDraft & { id: string };
export type AgentSummary = Pick<SavedAgent, 'id' | 'name' | 'description'>;
export type AgentField = keyof AgentDraft;

export const agentDescriptionLimit = 500;
export const agentInstructionsLimit = 16_000;

export function isAgentId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
}

function readText(value: unknown, limit: number) {
  if (typeof value === 'string' && value.length <= limit && value.isWellFormed()) return value.trim() || undefined;
}

export function readAgent(value: unknown): { draft: AgentDraft } | { field: AgentField } {
  const input = value as Partial<Record<AgentField, unknown>> | null | undefined;
  const name = readSubagentName(input?.name);
  if (!name) return { field: 'name' };
  const description = readText(input?.description, agentDescriptionLimit);
  if (!description) return { field: 'description' };
  const instructions = readText(input?.instructions, agentInstructionsLimit);
  if (!instructions) return { field: 'instructions' };
  const tools: unknown = input?.tools;
  if (!isAgentToolSelection(tools)) return { field: 'tools' };
  return { draft: { name, description, instructions, tools } };
}
