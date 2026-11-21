import { sample, type Event } from 'effector';
import { api, apiResponse } from '../../shared/http/api';
import { $activeSession, type ActiveSession } from './model';

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

export function inActiveSession<Completion extends { params: unknown }>(
  completion: Event<Completion>,
  sessionOf: (params: Completion['params']) => ActiveSession,
) {
  return sample({
    clock: completion,
    source: $activeSession,
    filter: (current, { params }) => current === sessionOf(params),
    fn: (_, result) => result,
  });
}
