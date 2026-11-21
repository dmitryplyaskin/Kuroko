import { createEffect, createEvent, createStore, sample } from 'effector';
import type { User } from '@kuroko/contracts/auth';
import { appStarted } from '../../app/lifecycle';
import { abortFx } from '../../shared/async/abort';
import { ApiError } from '../../shared/http/api';
import { authApi } from './authApi';

export type ActiveSession = { user: User; controller: AbortController };
type SessionState =
  | { status: 'loading' | 'unavailable' }
  | { status: 'guest'; notice?: string }
  | { status: 'authenticated'; session: ActiveSession };

export const sessionRetryRequested = createEvent();
export const sessionUserReceived = createEvent<User>();
export const sessionEndRequested = createEvent<{ session: ActiveSession; notice?: string }>();
export const protectedRequestFailed = createEvent<{ session: ActiveSession; error: unknown }>();

export const checkSessionFx = createEffect(() => authApi.session());
export const sessionStarted = sessionUserReceived.map((user): ActiveSession => ({ user, controller: new AbortController() }));
export const $session = createStore<SessionState>({ status: 'loading' });
export const $activeSession = $session.map((state) => state.status === 'authenticated' ? state.session : null);

export const sessionEnded = sample({
  clock: sessionEndRequested,
  source: $activeSession,
  filter: (current, { session }) => current === session,
  fn: (_, request) => request,
});

sample({
  clock: [appStarted, sessionRetryRequested],
  source: { state: $session, pending: checkSessionFx.pending },
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

sample({ clock: sessionEnded, fn: ({ session }) => session.controller, target: abortFx });

$session
  .on(checkSessionFx, () => ({ status: 'loading' }))
  .on(checkSessionFx.failData, (_, error) => ({
    status: error instanceof ApiError && error.status === 401 ? 'guest' : 'unavailable',
  }))
  .on(sessionStarted, (_, session) => ({ status: 'authenticated', session }))
  .on(sessionEnded, (_, { notice }) => ({ status: 'guest', notice }));
