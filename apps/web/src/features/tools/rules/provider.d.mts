import type { JsonObject } from '@kuroko/contracts/llm';
import type { CryptoDiceProvider } from '../dice/provider.mjs';

export class NumericRulesProvider {
  constructor(dice: CryptoDiceProvider, config?: { profiles: JsonObject[] });
  resolve(input: JsonObject, options?: { signal?: AbortSignal }): JsonObject;
}
