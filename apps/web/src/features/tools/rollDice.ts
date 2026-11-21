import type { JsonObject, LlmTool } from '@kuroko/contracts/llm';

export const rollDiceDeclaration: LlmTool = {
  name: 'roll_dice',
  description: 'Roll numeric dice for game mechanics. Pass rolls as a nested object or array with expression strings as leaves. '
    + 'Supports dN, NdN, arithmetic, parentheses, floor/ceil/round, max/min, and khK/klK to keep the highest/lowest dice chains. '
    + 'Use ! to explode on the maximum face, ro<3 to reroll a face once, or r<3 to reroll repeatedly. Reroll before exploding and put keep last. '
    + 'Comparisons return booleans. count(5d10, >=8) counts qualifying kept chains, while countFaces($pool, >=8 and !=10) counts accepted faces. '
    + 'face($pool) returns one kept face and errors on ambiguity. Save a pure dice leaf to reuse it as a pool. '
    + 'Use $attack or ref(["checks",0]) to reference saved results without rerolling. Forward references are allowed. '
    + 'Boolean not/and/or and if(test,then,else) evaluate lazily. All requested leaves are evaluated, so put conditional dice inside if. '
    + 'Example: {"rolls":{"attack":"2d20kh1 + 5","hit":"$attack >= 15","damage":"if($hit, 2d6! + 3, 0)"}}. '
    + 'Returns rollId, values, and any errors. A failed leaf is null; independent leaves still resolve. '
    + 'Use details only when the full trace is needed. Do not repeat a roll to seek a preferred result or choose actions for the player.',
  parameters: {
    type: 'object',
    properties: {
      rolls: {
        description: 'Nested object or array of expression strings.',
        oneOf: [{ type: 'object', additionalProperties: true }, { type: 'array', items: {} }],
      },
      purpose: { type: 'string', description: 'Optional brief purpose of the roll.', maxLength: 300 },
      details: { type: 'boolean', description: 'Include the full trace in the response. Defaults to false.' },
    },
    required: ['rolls'],
  },
};

export async function rollDice(args: JsonObject, callId: string, signal: AbortSignal) {
  const { rolls, purpose, details } = args;
  if (rolls === undefined && purpose === undefined && details === undefined) {
    return rollSingleDie(args.sides, signal);
  }
  if (!rolls || typeof rolls !== 'object' || (purpose !== undefined && typeof purpose !== 'string') ||
    (details !== undefined && typeof details !== 'boolean')) {
    return { result: 'Provide rolls as an object or array of expressions, an optional purpose string, and an optional details boolean.', isError: true as const };
  }

  const { CryptoDiceProvider } = await import('./dice/provider.mjs');
  try {
    const batch = new CryptoDiceProvider().roll(rolls, { signal, purpose });
    const result = { ...batch, rollId: callId };
    const modelResult = details ? undefined : {
      rollId: callId, values: batch.values, ...(batch.errors.length ? { errors: batch.errors } : {}),
    };
    return { result, modelResult };
  } catch (error) {
    signal.throwIfAborted();
    return { result: error instanceof TypeError ? error.message : 'The dice roll could not be completed.', isError: true as const };
  }
}

async function rollSingleDie(value: JsonObject[string] | undefined, signal: AbortSignal) {
  const sides = value === undefined ? 6 : value;
  if (typeof sides !== 'number' || !Number.isInteger(sides) || sides < 2 || sides > 1000) {
    return { result: 'Set sides to an integer between 2 and 1000.', isError: true as const };
  }
  const { CryptoDiceProvider } = await import('./dice/provider.mjs');
  const { values } = new CryptoDiceProvider().roll({ roll: `d${sides}` }, { signal });
  const roll = Array.isArray(values) ? undefined : values.roll;
  if (typeof roll !== 'number') return { result: 'The dice roll could not be completed.', isError: true as const };
  return { result: { sides, roll } };
}
