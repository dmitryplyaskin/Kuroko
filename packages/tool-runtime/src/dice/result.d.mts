import type { JsonObject } from '@kuroko/contracts/llm';
import type { DiceResult } from './provider.mjs';

export const DICE_RESULT_VERSION: 3;
export function compactDiceResult(result: DiceResult & { rollId: string }): JsonObject;
export function validateDiceResult(result: unknown): JsonObject | null;
