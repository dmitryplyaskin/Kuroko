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

export type ChatReasoningBlock = {
  text: string;
  /** UTF-16 offset in the assistant message's text. */
  textOffset: number;
  /** Omitted for reasoning before the first tool batch. */
  afterToolCallId?: string;
};

export type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** Older messages store their reasoning in a single block. */
  reasoning?: string;
  reasoningBlocks?: ChatReasoningBlock[];
  time: number;
  edited?: boolean;
  toolCalls?: ChatToolCall[];
};

export function chatReplyPrompt(messages: readonly ChatMessage[], replaceId?: number): ChatMessage | undefined {
  const last = messages.at(-1);
  if (replaceId !== undefined && (last?.role !== 'assistant' || last.id !== replaceId)) return;
  const prompt = replaceId === undefined ? last : messages.at(-2);
  if (prompt?.role === 'user' && prompt.id < Number.MAX_SAFE_INTEGER - 2) return prompt;
}

export type ChatSummary = { id: string; title: string; updatedAt: number };
export const chatTitleLimit = 64;

export const chatActivityKinds = ['reply', 'instruction', 'model', 'tool', 'agent'] as const;
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
export type ChatReplyVariants = { index: number; total: number };
export type ChatReplyVariantSelection = { replyId: number; index: number };
export type ChatSnapshot = { revision: number; messages: ChatMessage[]; gmMode?: boolean; activity?: ChatActivityTurn; replaceId?: number };
export type SavedChat = ChatSummary & Omit<ChatSnapshot, 'gmMode' | 'activity' | 'replaceId'> & {
  gmMode: boolean;
  activity?: ChatActivityTurn[];
  replyVariants?: Record<number, ChatReplyVariants>;
};
