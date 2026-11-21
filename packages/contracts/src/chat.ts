import type { JsonObject, JsonValue } from './llm';

export type ChatToolCall = {
  id: string;
  name: string;
  arguments: JsonObject;
  result: JsonValue;
  isError?: boolean;
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
export type ChatSnapshot = { revision: number; messages: ChatMessage[] };
export type SavedChat = ChatSummary & ChatSnapshot;
