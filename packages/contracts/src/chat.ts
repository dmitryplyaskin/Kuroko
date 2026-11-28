import type { JsonObject, JsonValue } from './llm';
import type { RealmSummary } from './realms';

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
  /** Server-rendered text for a player message. The editable source remains in text. */
  renderedText?: string;
  /** Older messages store their reasoning in a single block. */
  reasoning?: string;
  reasoningBlocks?: ChatReasoningBlock[];
  time: number;
  edited?: boolean;
  toolCalls?: ChatToolCall[];
  realmStart?: { id: string; title: string };
};

export function chatMessageText({ text, renderedText }: ChatMessage): string {
  return renderedText ?? text;
}

export function chatReplyPrompt(messages: readonly ChatMessage[], replaceId?: number): ChatMessage | undefined {
  const last = messages.at(-1);
  if (replaceId !== undefined && (last?.role !== 'assistant' || last.id !== replaceId)) return;
  const prompt = replaceId === undefined ? last : messages.at(-2);
  if (prompt?.role === 'user' && prompt.id < Number.MAX_SAFE_INTEGER - 2) return prompt;
}

export type ChatSummary = { id: string; title: string; createdAt: number; updatedAt: number; realmId?: string };
export type ChatListItem = ChatSummary & { realmTitle?: string; realmHasAvatar?: true; lastMessage?: string };
export type ChatCopyRequest = { id: string; title?: string };
export type ChatCreateRequest = {
  realmId: string;
  /** Reuse this client-generated ID when retrying creation. */
  id?: string;
};
export const chatTitleLimit = 64;

export function readChatTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const title = value.trim();
  if (title && title.isWellFormed() && !/\p{Cc}/u.test(title) && Array.from(title).length <= chatTitleLimit) return title;
}

export const chatActivityKinds = ['reply', 'instruction', 'model', 'tool', 'agent'] as const;
export const chatActivityStatuses = ['running', 'completed', 'failed', 'stopped'] as const;
export type ChatInstructionDetails = { instruction: string; systemOnly?: true };
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
export type ChatRealm = Pick<RealmSummary, 'id' | 'title' | 'hasAvatar'>;
export type SavedChat = ChatSummary & Omit<ChatSnapshot, 'gmMode' | 'activity' | 'replaceId'> & {
  gmMode: boolean;
  realm?: ChatRealm;
  activity?: ChatActivityTurn[];
  replyVariants?: Record<number, ChatReplyVariants>;
};
