export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly field?: string) {
    super(message);
  }
}

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: object; account?: number; signal?: AbortSignal };

export async function api<T>(path: string, { method = 'GET', body, account, signal }: Options = {}): Promise<T> {
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
  const timeout = AbortSignal.timeout(15_000);
  const response = await fetch(`/api${path}`, {
    method,
    mode: 'same-origin',
    headers,
    body: body && JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    const field = typeof result?.field === 'string' ? result.field : undefined;
    const message = response.status < 500 && typeof result?.error === 'string'
      ? result.error
      : 'Сервер не смог выполнить запрос.';
    throw new ApiError(response.status, message, field);
  }

  return response.status === 204 ? undefined as T : response.json();
}

export function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : 'Не удалось связаться с сервером. Попробуйте ещё раз.';
}
