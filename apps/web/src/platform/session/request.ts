import { api, apiResponse } from '../../shared/http/api';
import type { ActiveSession } from './model';

type RequestOptions = Omit<NonNullable<Parameters<typeof apiResponse>[1]>, 'account'>;

function forSession(session: ActiveSession, { signal, ...options }: RequestOptions = {}) {
  return {
    ...options,
    account: session.user.id,
    signal: signal ? AbortSignal.any([session.signal, signal]) : session.signal,
  };
}

export function sessionRequest<T>(session: ActiveSession, path: string, options?: RequestOptions) {
  return api<T>(path, forSession(session, options));
}

export function sessionResponse(session: ActiveSession, path: string, options?: RequestOptions) {
  return apiResponse(path, forSession(session, options));
}
