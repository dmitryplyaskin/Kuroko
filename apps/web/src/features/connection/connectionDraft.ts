import type { ErrorCode } from '../../shared/http/api';
import {
  defaultConnectionSettings, readConnectionSettings, readCustomBaseUrl,
  type ConnectionPreset, type Provider, type SaveConnectionPreset,
} from '@kuroko/contracts/connectionSettings';

export type NumericField = 'contextTokens' | 'responseTokens' | 'temperature' | 'topP' | 'topK';
type NumericValue = number | string;
export type ConnectionDraft = Record<NumericField, NumericValue> & {
  provider: Provider; model: string; keyId: string; baseUrl: string; openrouterProvider: string;
};

export function createDraft(preset?: ConnectionPreset): ConnectionDraft {
  const settings = preset ?? defaultConnectionSettings;
  return {
    provider: preset?.provider ?? 'openai',
    model: settings.model,
    keyId: preset?.keyId ?? '',
    baseUrl: settings.baseUrl ?? '',
    openrouterProvider: settings.openrouterProvider ?? '',
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

export function validateDraft(draft: ConnectionDraft, keyId: string, name: string):
  { preset: SaveConnectionPreset } | { code: ErrorCode } {
  if (draft.provider === 'custom' && !readCustomBaseUrl(draft.baseUrl)) return { code: 'custom_api_url_invalid' };

  const settings = readConnectionSettings(draft.provider, {
    model: draft.model.trim(),
    baseUrl: draft.baseUrl,
    openrouterProvider: draft.openrouterProvider || undefined,
    contextTokens: numericValue(draft.contextTokens),
    responseTokens: numericValue(draft.responseTokens),
    temperature: numericValue(draft.temperature),
    topP: numericValue(draft.topP),
    topK: numericValue(draft.topK),
  });
  if (!settings) return { code: 'preset_settings_invalid' };

  return { preset: { name, provider: draft.provider, settings, keyId: keyId || null } };
}
