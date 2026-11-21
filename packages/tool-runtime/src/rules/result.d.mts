import type { JsonObject } from '@kuroko/contracts/llm';

export function compactCheckResult(result: JsonObject & { rollId: string }): JsonObject;
export function validateCheckResult(result: unknown): JsonObject | null;
