export const llmErrorCodes = [
  'invalid_request', 'missing_preset', 'missing_key', 'provider_rejected', 'provider_rate_limit',
  'provider_unavailable', 'provider_protocol', 'custom_api_address_blocked', 'timeout', 'internal_error',
] as const;

export const apiErrorCodes = [
  ...llmErrorCodes,
  'request_rejected', 'request_failed', 'invalid_json', 'payload_too_large', 'unsupported_request_format',
  'api_route_not_found', 'route_not_found', 'server_error',
  'auth_required', 'auth_rate_limit', 'username_invalid', 'password_length', 'username_taken',
  'invalid_credentials', 'current_password_invalid', 'password_unchanged', 'account_name_mismatch',
  'chat_settings_invalid', 'chat_not_found', 'chat_conflict', 'preset_name_invalid', 'preset_settings_invalid', 'preset_not_found',
  'instruction_text_invalid', 'prompt_template_invalid',
  'gm_scene_unpublished', 'gm_response_length', 'response_blocked',
  'realm_invalid', 'realm_duplicate_id', 'realm_reference_missing', 'realm_id_taken', 'realm_not_found', 'realm_conflict',
  'realm_start_not_found', 'realm_variable_name_invalid', 'realm_variable_value_invalid',
  'agent_invalid', 'agent_not_found',
  'preset_name_taken', 'provider_key_invalid', 'provider_key_name_taken', 'provider_key_not_found',
  'model_catalog_selection_invalid', 'model_catalog_key_invalid', 'model_catalog_rejected',
  'model_catalog_rate_limit', 'model_catalog_unavailable',
  'custom_api_url_invalid', 'openrouter_endpoints_unavailable',
] as const;

export type LlmErrorCode = (typeof llmErrorCodes)[number];
export type ApiErrorCode = (typeof apiErrorCodes)[number];
export type ErrorBody<Code extends ApiErrorCode = ApiErrorCode> = { code: Code; field?: string };

export function errorBody<Code extends ApiErrorCode>(code: Code, field?: string): ErrorBody<Code> {
  return field === undefined ? { code } : { code, field };
}

const knownApiErrors: ReadonlySet<string> = new Set(apiErrorCodes);
const knownLlmErrors: ReadonlySet<string> = new Set(llmErrorCodes);

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && knownApiErrors.has(value);
}

export function isLlmErrorCode(value: unknown): value is LlmErrorCode {
  return typeof value === 'string' && knownLlmErrors.has(value);
}

export class CodedError<Code extends string = string> extends Error {
  constructor(
    public readonly code: Code,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code);
    this.name = new.target.name;
  }
}
