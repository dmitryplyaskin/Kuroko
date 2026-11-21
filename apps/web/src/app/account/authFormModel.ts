import { createEffect, createEvent, createStore, sample } from 'effector';
import { authApi, authError } from '../../platform/session/authApi';
import { $session, sessionStarted, sessionUserReceived } from '../../platform/session/model';

type Credentials = { password: FormDataEntryValue | null; remember: boolean };

export const authModeSwitched = createEvent();
export const usernameChanged = createEvent<string>();
export const authSubmitted = createEvent<Credentials>();

const submitAuthFx = createEffect(({ registering, username, password, remember }: Credentials & {
  registering: boolean; username: string;
}) => registering ? authApi.register(username, password) : authApi.login(username, password, remember));

export const $authPending = submitAuthFx.pending;
export const $registering = createStore(false)
  .on(authModeSwitched, (value) => !value)
  .reset(submitAuthFx.doneData, sessionStarted);
export const $registered = createStore(false)
  .on(submitAuthFx.done, (_, { params }) => params.registering)
  .reset(authModeSwitched, sessionStarted);
export const $username = createStore('')
  .on(usernameChanged, (_, value) => value)
  .on(submitAuthFx.done, (current, { params, result }) => params.registering ? result.username : current)
  .reset(sessionStarted);
export const $authError = createStore<ReturnType<typeof authError> | null>(null)
  .on(submitAuthFx.failData, (_, error) => authError(error))
  .reset(submitAuthFx, authModeSwitched, sessionStarted);

sample({
  clock: authSubmitted,
  source: { session: $session, pending: $authPending, registering: $registering, username: $username },
  filter: ({ session, pending }) => session.status === 'guest' && !pending,
  fn: ({ registering, username }, credentials) => ({ registering, username, ...credentials }),
  target: submitAuthFx,
});

sample({
  clock: submitAuthFx.done,
  filter: ({ params }) => !params.registering,
  fn: ({ result }) => result,
  target: sessionUserReceived,
});
