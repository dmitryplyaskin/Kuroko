export const providers = {
  openai: { label: 'OpenAI', temperatureMax: 2, topK: false },
  openrouter: { label: 'OpenRouter', temperatureMax: 2, topK: true },
  anthropic: { label: 'Anthropic', temperatureMax: 1, topK: true },
  gemini: { label: 'Google Gemini', temperatureMax: 2, topK: true },
} as const;

export type Provider = keyof typeof providers;
export type ConnectionSettings = {
  model: string;
  contextTokens: number | null;
  responseTokens: number | null;
  temperature: number | null;
  topP: number | null;
  topK: number | null;
};

export type ConnectionPreset = ConnectionSettings & { id: string; name: string; provider: Provider; keyId: string | null };
export type ProviderKey = { id: string; name: string; provider: Provider };
export type ConnectionState = {
  activePresetId: string | null;
  presets: ConnectionPreset[];
  keys: ProviderKey[];
};
export type ProviderModel = { id: string; inputLimit?: number; outputLimit?: number; contextLimit?: number };

export const connectionNameLimit = 120;

export function readConnectionName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().normalize();
  if (name.length > 0 && name.length <= connectionNameLimit && name.isWellFormed() && !/[\p{Cc}]/u.test(name)) return name;
}

export const defaultConnectionSettings: ConnectionSettings = {
  model: '', contextTokens: null, responseTokens: null, temperature: null, topP: null, topK: null,
};

export function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && Object.hasOwn(providers, value);
}

export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && /^[a-z\d@][a-z\d._:@/-]{0,255}$/i.test(value);
}

export function isApiKey(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && /^[!-~]{1,4096}$/.test(value);
}

function isOptionalNumber(value: unknown, min: number, max: number, integer = false): value is number | null {
  return value === null || (typeof value === 'number' && value >= min && value <= max && (!integer || Number.isSafeInteger(value)));
}

export function readConnectionSettings(provider: Provider, value: unknown): ConnectionSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { model, contextTokens, responseTokens, temperature, topP, topK } = value as Record<string, unknown>;
  const limits = providers[provider];
  if (!isModelId(model) || !isOptionalNumber(contextTokens, 1, Number.MAX_SAFE_INTEGER, true) ||
    !isOptionalNumber(responseTokens, 1, Number.MAX_SAFE_INTEGER, true) ||
    !isOptionalNumber(temperature, 0, limits.temperatureMax) || !isOptionalNumber(topP, 0, 1) ||
    !isOptionalNumber(topK, 1, Number.MAX_SAFE_INTEGER, true) || (!limits.topK && topK !== null)) return undefined;

  return { model, contextTokens, responseTokens, temperature, topP, topK };
}
