import type { LlmErrorBody, LlmErrorCode } from '@kuroko/contracts/llm';

const errors = {
  invalid_request: [400, 'Проверьте сообщения, инструменты и параметры генерации.'],
  missing_preset: [404, 'Пресет подключения не найден.'],
  missing_key: [422, 'Выберите сохранённый API-ключ в пресете подключения.'],
  provider_rejected: [422, 'Провайдер отклонил запрос. Проверьте API-ключ, модель и параметры.'],
  provider_rate_limit: [429, 'Провайдер ограничил запросы. Повторите позже.'],
  provider_unavailable: [502, 'Не удалось получить ответ от провайдера.'],
  provider_protocol: [502, 'Провайдер вернул некорректный или неполный ответ.'],
  timeout: [504, 'Провайдер не ответил за отведённое время.'],
  internal_error: [500, 'Не удалось выполнить генерацию.'],
} as const satisfies Record<LlmErrorCode, readonly [number, string]>;

export class LlmError extends Error {
  readonly status: number;
  readonly body: LlmErrorBody;

  constructor(code: LlmErrorCode) {
    const [status, error] = errors[code];
    super(error);
    this.status = status;
    this.body = { code, error };
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
