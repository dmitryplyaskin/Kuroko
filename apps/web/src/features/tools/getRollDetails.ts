import type { ChatToolCall } from '@kuroko/contracts/chat';
import type { JsonObject, JsonValue, LlmTool } from '@kuroko/contracts/llm';

const maxRollIds = 20;

export const rollDetailsDeclaration: LlmTool = {
  name: 'getRollDetails',
  description: 'Read saved roll_dice or resolveCheck traces from this chat using their rollIds. Use only when a compact result is insufficient. '
    + 'Includes individual dice, rerolls, explosions, selected faces, references, and the rules snapshot for a check. '
    + 'One rollId covers the entire saved invocation. Missing or invalid IDs are reported separately. This never rolls again.',
  parameters: {
    type: 'object', additionalProperties: false, required: ['rollIds'],
    properties: { rollIds: { type: 'array', minItems: 1, maxItems: maxRollIds, items: { type: 'string' } } },
  },
};

function object(value: JsonValue): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

export function toolHistoryResult(call: ChatToolCall): JsonValue {
  if (call.modelResult !== undefined) return call.modelResult;
  const data = object(call.result);
  // Earlier versions recorded details:true without a separate compact result.
  if (call.name === 'roll_dice' && data?.schemaVersion === 3 && data.values !== undefined && Array.isArray(data.errors)) {
    return { rollId: data.rollId ?? call.id, values: data.values, ...(data.errors.length ? { errors: data.errors } : {}) };
  }
  return call.result;
}

export async function getRollDetails({ rollIds }: JsonObject, history: readonly ChatToolCall[]) {
  if (!Array.isArray(rollIds) || !rollIds.length || rollIds.length > maxRollIds ||
    !rollIds.every((id): id is string => typeof id === 'string' && Boolean(id.trim())) || new Set(rollIds).size !== rollIds.length) {
    return { result: `Provide 1 to ${maxRollIds} distinct rollId values from this chat.`, isError: true as const };
  }

  const [{ validateDiceResult }, { validateCheckResult }] = await Promise.all([
    import('./dice/result.mjs'), import('./rules/result.mjs'),
  ]);
  const rolls = rollIds.map((rollId) => {
    const matches = history.filter((call) => (call.name === 'roll_dice' || call.name === 'resolveCheck') &&
      (call.id === rollId || object(call.result)?.rollId === rollId));
    if (!matches.length) return failure(rollId, 'not_found', 'No saved roll with this rollId in this chat. Do not reroll it.');
    if (matches.length > 1) return failure(rollId, 'ambiguous_id', 'Multiple saved rolls use this rollId.');
    const call = matches[0]!;
    const data = object(call.result);
    let result: JsonObject | null = null;
    if (data && !call.isError && (data.rollId === undefined || data.rollId === rollId)) {
      if (call.name === 'resolveCheck') result = validateCheckResult(data);
      else if (data.schemaVersion !== undefined) result = validateDiceResult(data);
      else result = readLegacySingleRoll(data);
    }
    return result ? { summary: { rollId, tool: call.name } satisfies JsonObject, result }
      : failure(rollId, 'invalid_record', 'The saved roll is incomplete or inconsistent. Do not reroll it.');
  });

  // The original roll records already contain the full traces. Keep only lookup references in chat history.
  return {
    result: { rolls: rolls.map(({ summary }) => summary) },
    replyResult: { rolls: rolls.map(({ summary, result }) => result ? { ...summary, result } : summary) },
  };
}

function failure(rollId: string, code: string, message: string) {
  return { summary: { rollId, error: { code, message } } satisfies JsonObject, result: null };
}

function readLegacySingleRoll({ sides, roll }: JsonObject): JsonObject | null {
  if (typeof sides !== 'number' || !Number.isSafeInteger(sides) || sides < 2 || sides > 1000 ||
    typeof roll !== 'number' || !Number.isSafeInteger(roll) || roll < 1 || roll > sides) return null;
  return { sides, roll };
}
