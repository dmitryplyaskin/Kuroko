import { CodedError, type LlmErrorCode } from '@kuroko/contracts/errors';
import type { LlmErrorBody } from '@kuroko/contracts/llm';

const errors = {
  invalid_request: 400,
  missing_preset: 404,
  missing_key: 422,
  provider_rejected: 422,
  provider_rate_limit: 429,
  provider_unavailable: 502,
  provider_protocol: 502,
  timeout: 504,
  internal_error: 500,
} as const satisfies Record<LlmErrorCode, number>;

export class LlmError extends CodedError<LlmErrorCode> {
  readonly status: number;
  readonly body: LlmErrorBody;

  constructor(code: LlmErrorCode) {
    super(code);
    this.status = errors[code];
    this.body = { code };
  }
}

export function upstreamError(status: unknown) {
  if (status === 429 || status === 'rate_limit_error' || status === 'RESOURCE_EXHAUSTED') {
    return new LlmError('provider_rate_limit');
  }
  if (status === 408 || status === 504 || status === 'DEADLINE_EXCEEDED') return new LlmError('timeout');
  if ((typeof status === 'number' && status >= 400 && status < 500) || status === 'invalid_request_error') {
    return new LlmError('provider_rejected');
  }
  return new LlmError('provider_unavailable');
}
