import type { MessageKey } from '../../shared/i18n/i18n';
import { createEffect, createEvent, createStore, sample, type Event } from 'effector';
import type { User } from '@kuroko/contracts/auth';
import { appStarted } from '../lifecycle';
import { abortFx } from '../../shared/async/abort';
import { ApiError } from '../../shared/http/api';
import { authApi } from './authApi';

export type ActiveSession = Readonly<{ user: User; signal: AbortSignal }>;

type SessionState =
  | { status: 'loading' | 'unavailable' }
  | { status: 'guest'; notice?: MessageKey }
  | { status: 'authenticated'; session: ActiveSession; controller: AbortController };

export const sessionRetryRequested = createEvent();
export const sessionUserReceived = createEvent<User>();
export const sessionEndRequested = createEvent<{ session: ActiveSession; notice?: MessageKey }>();
export const protectedRequestFailed = createEvent<{ session: ActiveSession; error: unknown }>();

export const checkSessionFx = createEffect(() => authApi.session());
const sessionActivated = sessionUserReceived.map((user) => {
  const controller = new AbortController();
  return { status: 'authenticated' as const, session: { user, signal: controller.signal }, controller };
});
export const sessionStarted = sessionActivated.map(({ session }): ActiveSession => session);

const $state = createStore<SessionState>({ status: 'loading' });
export const $session = $state.map((state) =>
  state.status === 'authenticated' ? { status: state.status, session: state.session } : state);
export const $activeSession = $session.map((state) => state.status === 'authenticated' ? state.session : null);

const sessionClosing = sample({
  clock: sessionEndRequested,
  source: $state,
  fn: (current, request) => current.status === 'authenticated' && current.session === request.session
    ? { ...request, controller: current.controller }
    : undefined,
}).filterMap((request) => request);

export const sessionEnded = sessionClosing.map(({ session, notice }) => ({ session, notice }));

sample({
  clock: [appStarted, sessionRetryRequested],
  source: { state: $state, pending: checkSessionFx.pending },
  filter: ({ state, pending }) => !pending && (state.status === 'loading' || state.status === 'unavailable'),
  fn: () => undefined,
  target: checkSessionFx,
});

sample({ clock: checkSessionFx.doneData, target: sessionUserReceived });

sample({
  clock: protectedRequestFailed,
  filter: ({ error }) => error instanceof ApiError && error.status === 401,
  fn: ({ session }) => ({ session }),
  target: sessionEndRequested,
});

sample({ clock: sessionClosing, fn: ({ controller }) => controller, target: abortFx });

$state
  .on(checkSessionFx, () => ({ status: 'loading' }))
  .on(checkSessionFx.failData, (_, error) => ({
    status: error instanceof ApiError && error.status === 401 ? 'guest' : 'unavailable',
  }))
  .on(sessionActivated, (_, state) => state)
  .on(sessionEnded, (_, { notice }) => ({ status: 'guest', notice }));

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
