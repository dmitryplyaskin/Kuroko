import {
  defaultConnectionSettings, readConnectionName, readConnectionSettings,
  type ConnectionPreset, type ConnectionSettings, type Provider, type SaveConnectionPreset,
} from '@kuroko/contracts/connectionSettings';

export type NumericField = Exclude<keyof ConnectionSettings, 'model'>;
type NumericValue = number | string;
export type ConnectionDraft = Record<NumericField, NumericValue> & { name: string; provider: Provider; model: string; keyId: string };

export function createDraft(preset?: ConnectionPreset): ConnectionDraft {
  const settings = preset ?? defaultConnectionSettings;
  return {
    name: preset?.name ?? '',
    provider: preset?.provider ?? 'openai',
    model: settings.model,
    keyId: preset?.keyId ?? '',
    contextTokens: settings.contextTokens ?? '',
    responseTokens: settings.responseTokens ?? '',
    temperature: settings.temperature ?? '',
    topP: settings.topP ?? '',
    topK: settings.topK ?? '',
  };
}

export function numericValue(value: NumericValue) {
  return value === '' ? null : Number(value);
}

export function validateDraft(draft: ConnectionDraft, keyId: string):
  { preset: SaveConnectionPreset } | { error: string; field?: 'name' } {
  const name = readConnectionName(draft.name);
  if (!name) return { error: 'Введите название пресета длиной до 120 символов.', field: 'name' };

  const settings = readConnectionSettings(draft.provider, {
    model: draft.model.trim(),
    contextTokens: numericValue(draft.contextTokens),
    responseTokens: numericValue(draft.responseTokens),
    temperature: numericValue(draft.temperature),
    topP: numericValue(draft.topP),
    topK: numericValue(draft.topK),
  });
  if (!settings) return { error: 'Проверьте ID модели и значения в полях генерации и лимитов.' };

  return { preset: { name, provider: draft.provider, settings, keyId: keyId || null } };
}
