import type { ConnectionSettings, Provider } from './connectionSettings';

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

export type LlmParameters = Partial<Omit<ConnectionSettings, 'model'>>;
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

export type LlmErrorCode =
  | 'invalid_request' | 'missing_preset' | 'missing_key' | 'provider_rejected' | 'provider_rate_limit'
  | 'provider_unavailable' | 'provider_protocol' | 'timeout' | 'internal_error';
export type LlmErrorBody = { code: LlmErrorCode; error: string };
export type LlmEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; call: LlmToolCall }
  | { type: 'done'; completion: LlmCompletion }
  | ({ type: 'error' } & LlmErrorBody);
