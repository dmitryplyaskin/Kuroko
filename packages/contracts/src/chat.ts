import type { JsonObject, JsonValue } from './llm';

export type ChatToolCall = {
  id: string;
  name: string;
  arguments: JsonObject;
  result: JsonValue;
  modelResult?: JsonValue;
  isError?: boolean;
  /** UTF-16 offset in the assistant message's text. Older messages omit this. */
  textOffset?: number;
};

export type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  time: number;
  edited?: boolean;
  toolCalls?: ChatToolCall[];
};

export type ChatSummary = { id: string; title: string; updatedAt: number };
export const chatTitleLimit = 64;

export const chatActivityKinds = ['reply', 'model', 'tool', 'agent'] as const;
export const chatActivityStatuses = ['running', 'completed', 'failed', 'stopped'] as const;
export type ChatActivityEntry = {
  id: string;
  kind: (typeof chatActivityKinds)[number];
  status: (typeof chatActivityStatuses)[number];
  time: number;
  duration?: number;
  name?: string;
  agentId?: string;
  details: JsonObject;
};
export type ChatActivityTurn = { promptId: number; entries: ChatActivityEntry[] };
export type ChatSnapshot = { revision: number; messages: ChatMessage[]; gmMode?: boolean; activity?: ChatActivityTurn };
export type SavedChat = ChatSummary & Omit<ChatSnapshot, 'gmMode' | 'activity'> & {
  gmMode: boolean;
  activity?: ChatActivityTurn[];
};
