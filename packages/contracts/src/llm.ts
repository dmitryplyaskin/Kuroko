import type { ConnectionSettings, Provider } from './connectionSettings';
import type { LlmErrorCode } from './errors';
export type { LlmErrorCode } from './errors';

export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type LlmTool = { name: string; description?: string; parameters: JsonObject };
export type LlmToolChoice = 'auto' | 'none' | 'required' | { name: string };
export type LlmToolCall = {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: JsonObject;
  geminiId?: string;
  geminiSignature?: string;
};
export type LlmAssistantPart =
  | { type: 'text'; text: string; geminiSignature?: string }
  | { type: 'geminiThought'; text: string; geminiSignature: string }
  | LlmToolCall;
export type LlmAssistantMessage = {
  role: 'assistant';
  parts: LlmAssistantPart[];
  openrouterReasoning?: JsonObject[];
};
export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | LlmAssistantMessage
  | { role: 'tool'; callId: string; content: JsonValue; isError?: boolean };

export type LlmParameters = Partial<Omit<ConnectionSettings, 'model' | 'baseUrl' | 'openrouterProvider'>>;
export type LlmRequest = {
  presetId?: string;
  messages: LlmMessage[];
  parameters?: LlmParameters;
  tools?: LlmTool[];
  toolChoice?: LlmToolChoice;
  stream?: boolean;
};

export type LlmUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
export type LlmFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'other';
export type LlmCompletion = {
  presetId: string;
  provider: Provider;
  model: string;
  message: LlmAssistantMessage;
  finishReason: LlmFinishReason;
  providerFinishReason: string;
  usage?: LlmUsage;
  contextTokens: number | null;
  contextLimitExceeded?: boolean;
};

export type LlmErrorBody = { code: LlmErrorCode };
export type LlmEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; call: LlmToolCall }
  | { type: 'done'; completion: LlmCompletion }
  | ({ type: 'error' } & LlmErrorBody);
