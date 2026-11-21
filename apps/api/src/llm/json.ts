import type { JsonObject, JsonValue } from '@kuroko/contracts/llm';
import { LlmError } from './llmErrors';

export function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value as unknown[] : [];
}

export function jsonValue(value: unknown, depth = 0): value is JsonValue {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.isWellFormed();
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= 64) return false;
  if (Array.isArray(value)) return value.every((item: unknown) => jsonValue(item, depth + 1));
  const object = record(value);
  return !!object && Object.values(object).every((item) => jsonValue(item, depth + 1));
}

export function jsonObject(value: unknown): value is JsonObject {
  return !!record(value) && jsonValue(value);
}

export function parseObject(text: string) {
  try {
    const value = record(JSON.parse(text) as unknown);
    if (value) return value;
  } catch {
    // Provider payloads are excluded from public errors.
  }
  throw new LlmError('provider_protocol');
}
