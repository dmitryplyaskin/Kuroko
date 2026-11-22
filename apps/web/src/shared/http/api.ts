import { CodedError, isApiErrorCode, type ApiErrorCode } from '@kuroko/contracts/errors';

export type ErrorCode = ApiErrorCode
  | 'network_error' | 'request_timeout' | 'invalid_response' | 'stream_interrupted' | 'response_blocked' | 'response_empty'
  | 'response_length' | 'tool_round_limit'
  | 'session_check_failed' | 'password_confirmation_mismatch' | 'model_catalog_key_required'
  | 'model_id_invalid' | 'number_integer_min' | 'number_range' | 'message_action_failed' | 'image_load_failed'
  | 'clipboard_write_failed' | 'module_load_failed'
  | 'realm_file_unreadable' | 'realm_file_format' | 'realm_file_invalid_json' | 'realm_file_png_card' | 'realm_file_download_failed';

export class ApiError extends CodedError<ErrorCode> {
  constructor(public readonly status: number, code: ErrorCode, public readonly field?: string) {
    super(code);
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: object;
  account?: number;
  signal?: AbortSignal;
  accept?: string;
  timeoutMs?: number;
};

export async function apiResponse(
  path: string, { method = 'GET', body, account, signal, accept, timeoutMs = 15_000 }: Options = {},
): Promise<Response> {
  const headers = new Headers();
  if (method !== 'GET') {
    headers.set('X-Kuroko-Request', '1');
  }
  if (body) {
    headers.set('Content-Type', 'application/json');
  }
  if (account !== undefined) {
    headers.set('X-Kuroko-Account', String(account));
  }
  if (accept) headers.set('Accept', accept);
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(`/api${path}`, {
    method,
    mode: 'same-origin',
    headers,
    body: body && JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    throw new ApiError(0, timeout.aborted ? 'request_timeout' : 'network_error');
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    const field = typeof result?.field === 'string' ? result.field : undefined;
    const code = isApiErrorCode(result?.code) ? result.code : response.status >= 500 ? 'server_error' : 'request_failed';
    throw new ApiError(response.status, code, field);
  }
  return response;
}

export async function api<T>(path: string, options?: Options): Promise<T> {
  const response = await apiResponse(path, options);
  return response.status === 204 ? undefined as T : response.json().catch((error: unknown) => {
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error;
    throw new ApiError(response.status, 'invalid_response');
  });
}

export function errorCode(error: unknown): ErrorCode {
  if (error instanceof ApiError) return error.code;
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'request_timeout';
  return 'network_error';
}
