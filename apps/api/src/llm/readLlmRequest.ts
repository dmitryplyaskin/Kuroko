import { connectionParameterRanges, isOptionalConnectionNumber, type Provider } from '@kuroko/contracts/connectionSettings';
import type {
  LlmAssistantPart, LlmMessage, LlmParameters, LlmRequest, LlmTool, LlmToolChoice,
} from '@kuroko/contracts/llm';
import { jsonObject, jsonValue, record } from './json';
import { LlmError } from './llmErrors';

const parameterNames = ['contextTokens', 'responseTokens', 'temperature', 'topP', 'topK'] as const;

function invalid(): never {
  throw new LlmError('invalid_request');
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed();
}

export function isToolCallId(value: unknown): value is string {
  return isText(value) && value.length > 0 && value.length <= 256 && !/[\p{Cc}\s]/u.test(value);
}

export function isToolName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z_][\w-]{0,63}$/i.test(value);
}

function readAssistantPart(value: unknown): LlmAssistantPart {
  const part = record(value);
  if (!part) invalid();
  const { type, text, id, name, arguments: args, geminiId, geminiSignature } = part;
  if (geminiSignature !== undefined && !isText(geminiSignature)) invalid();
  if (type === 'text' && isText(text)) return { type, text, geminiSignature };
  if (type === 'geminiThought' && isText(text) && geminiSignature) return { type, text, geminiSignature };
  if (type === 'toolCall' && isToolCallId(id) && isToolName(name) && jsonObject(args) &&
    (geminiId === undefined || isToolCallId(geminiId))) {
    return { type, id, name, arguments: args, geminiId, geminiSignature };
  }
  return invalid();
}

function readMessages(values: unknown): LlmMessage[] {
  if (!Array.isArray(values) || !values.length) invalid();
  let sawUser = false;
  const pending = new Set<string>();
  const messages = values.map((value: unknown): LlmMessage => {
    const message = record(value);
    if (!message) invalid();
    const { role, content, callId, isError, parts, openrouterReasoning } = message;

    if (role === 'tool') {
      if (!isToolCallId(callId) || !pending.delete(callId) || !jsonValue(content) || (isError !== undefined && typeof isError !== 'boolean')) {
        invalid();
      }
      return { role, callId, content, isError };
    }

    if (pending.size) invalid();
    if (role === 'system' && !sawUser && isText(content) && content.trim()) return { role, content };
    if (role === 'user' && isText(content) && content.trim()) {
      sawUser = true;
      return { role, content };
    }
    if (role === 'assistant' && sawUser && Array.isArray(parts) && parts.length) {
      if (openrouterReasoning !== undefined &&
        (!Array.isArray(openrouterReasoning) || !openrouterReasoning.every(jsonObject))) invalid();
      const assistantParts = parts.map(readAssistantPart);
      if (!assistantParts.some((part) => part.type === 'toolCall' || (part.type === 'text' && part.text.trim()))) invalid();
      for (const part of assistantParts) {
        if (part.type !== 'toolCall') continue;
        if (pending.has(part.id)) invalid();
        pending.add(part.id);
      }
      return { role, parts: assistantParts, openrouterReasoning };
    }
    return invalid();
  });
  const last = messages.at(-1)?.role;
  if (pending.size || (last !== 'user' && last !== 'tool')) invalid();
  return messages;
}

function readTools(value: unknown): LlmTool[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) invalid();
  const names = new Set<string>();
  return value.map((item: unknown) => {
    const tool = record(item);
    if (!tool) invalid();
    const { name, description, parameters } = tool;
    if (!isToolName(name) || names.has(name) || (description !== undefined && !isText(description)) ||
      !jsonObject(parameters) || parameters.type !== 'object') invalid();
    names.add(name);
    return { name, description, parameters };
  });
}

function readToolChoice(value: unknown, tools: LlmTool[]): LlmToolChoice | undefined {
  if (value === undefined || value === 'auto' || value === 'none') return value;
  if (value === 'required' && tools.length) return value;
  const name = record(value)?.name;
  if (isToolName(name) && tools.some((tool) => tool.name === name)) return { name };
  return invalid();
}

function readParameters(value: unknown): LlmParameters | undefined {
  if (value === undefined) return;
  const params = record(value);
  if (!params) invalid();
  const parameters: LlmParameters = {};
  for (const [name, number] of Object.entries(params)) {
    const key = parameterNames.find((key) => key === name);
    if (!key || (number !== null && (typeof number !== 'number' || !Number.isFinite(number)))) invalid();
    parameters[key] = number;
  }
  return parameters;
}

export function readLlmRequest(value: unknown): LlmRequest {
  const input = record(value);
  if (!input) invalid();
  if (Object.keys(input).some((key) => !['presetId', 'messages', 'parameters', 'tools', 'toolChoice', 'stream'].includes(key))) invalid();
  const { presetId, messages, parameters, tools, toolChoice, stream } = input;
  if ((presetId !== undefined && (typeof presetId !== 'string' || !/^[a-f\d-]{32,36}$/i.test(presetId))) ||
    (stream !== undefined && typeof stream !== 'boolean')) invalid();
  const declarations = readTools(tools);
  return {
    presetId, stream, messages: readMessages(messages), parameters: readParameters(parameters),
    tools: declarations, toolChoice: readToolChoice(toolChoice, declarations),
  };
}

export function validateParameterOverrides(provider: Provider, parameters: LlmParameters | undefined) {
  const ranges = connectionParameterRanges(provider);
  for (const name of parameterNames) {
    const value = parameters?.[name];
    if (value === undefined) continue;
    if (!isOptionalConnectionNumber(value, ranges[name]) || (provider === 'openai' && name === 'topK' && value !== null)) invalid();
  }
}
