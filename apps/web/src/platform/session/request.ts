import { sample, type Event } from 'effector';
import { api } from '../../shared/http/api';
import { $activeSession, type ActiveSession } from './model';

type RequestOptions = Omit<NonNullable<Parameters<typeof api>[1]>, 'account' | 'signal'> & {
  signal?: AbortSignal;
};

export function sessionRequest<T>(session: ActiveSession, path: string, { signal, ...options }: RequestOptions = {}) {
  return api<T>(path, {
    ...options,
    account: session.user.id,
    signal: signal ? AbortSignal.any([session.signal, signal]) : session.signal,
  });
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
