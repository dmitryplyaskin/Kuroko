import type { JsonObject, LlmTool } from '@kuroko/contracts/llm';

export const resolveCheckDeclaration: LlmTool = {
  name: 'resolveCheck',
  description: 'Resolve a numeric game check against an established target using a rules profile. '
    + 'For standard, critical and attack, sides sets the die size and defaults to 20. Standard compares total >= target. '
    + 'Critical and attack make the highest face a critical success. A natural 1 is a critical failure in critical and an automatic miss in attack. '
    + 'The legacy d20-critical and d20-attack profiles use d20. Advantage keeps the higher die; disadvantage keeps the lower die. '
    + 'Only the selected face determines criticals. When damage applies, declare the normal formula and the critical formula for a profile with critical success. '
    + 'Rolls damage only on a hit and only for the applicable outcome. Does not change HP or choose actions for the player. '
    + 'Returns a compact check and rollId. If enabled, use getRollDetails by rollId when you need the full trace. Do not reroll saved outcomes.',
  parameters: {
    type: 'object', additionalProperties: false, required: ['profile', 'target'],
    properties: {
      profile: { type: 'string', enum: ['standard', 'critical', 'attack', 'd20-critical', 'd20-attack'] },
      sides: { type: 'integer', minimum: 2, maximum: 1_000_000, description: 'Die size for standard, critical and attack. Defaults to 20.' },
      target: { type: 'number', description: 'Established difficulty or defense.' },
      modifier: { type: 'number', description: 'Added to the chosen die. Defaults to 0.' },
      mode: { type: 'string', enum: ['normal', 'advantage', 'disadvantage'], description: 'Defaults to normal.' },
      damage: {
        type: 'object', additionalProperties: false, required: ['normal'],
        properties: {
          normal: { type: 'string', description: 'Damage expression for a normal hit.' },
          critical: { type: 'string', description: 'Required if the chosen profile has critical success.' },
        },
      },
      purpose: { type: 'string', maxLength: 300, description: 'Optional purpose stated before rolling.' },
      details: { type: 'boolean', description: 'Include the full trace immediately. Defaults to false.' },
    },
  },
};

export async function resolveCheck(args: JsonObject, rollId: string, signal: AbortSignal) {
  const [{ CryptoDiceProvider }, { NumericRulesProvider }, { compactCheckResult }] = await Promise.all([
    import('./dice/provider.mjs'), import('./rules/provider.mjs'), import('./rules/result.mjs'),
  ]);
  try {
    const result = { ...new NumericRulesProvider(new CryptoDiceProvider()).resolve(args, { signal }), rollId };
    return { result, modelResult: compactCheckResult(result), replyResult: args.details === true ? result : undefined };
  } catch (error) {
    signal.throwIfAborted();
    return { result: error instanceof TypeError ? error.message : 'The check could not be completed.', isError: true as const };
  }
}
