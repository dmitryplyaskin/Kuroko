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
export type ChatSnapshot = { revision: number; messages: ChatMessage[]; gmMode?: boolean };
export type SavedChat = ChatSummary & ChatSnapshot & { gmMode: boolean };
