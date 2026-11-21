import type { JsonObject, JsonValue } from '@kuroko/contracts/llm';

type DiceError = { path: (string | number)[]; code: string; message: string };
type DiceResult = JsonObject & {
  schemaVersion: number;
  values: JsonObject | JsonValue[];
  errors: DiceError[];
  observations: JsonObject[];
  details: JsonObject[];
};

export class CryptoDiceProvider {
  constructor(config?: Record<string, number>, draw?: (sides: number) => number);
  validate(rolls: JsonObject | JsonValue[], options?: { purpose?: string }): { errors: DiceError[] };
  roll(rolls: JsonObject | JsonValue[], options?: { signal?: AbortSignal; purpose?: string }): DiceResult;
}
