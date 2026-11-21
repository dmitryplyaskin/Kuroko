import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import { authApi, authError } from '../../platform/session/authApi';
import { $activeSession, protectedRequestFailed, sessionEnded, sessionEndRequested, type ActiveSession } from '../../platform/session/model';

type ProfileAction = { kind: 'logout' }
  | { kind: 'password'; currentPassword: FormDataEntryValue | null; newPassword: FormDataEntryValue | null; confirmation: FormDataEntryValue | null }
  | { kind: 'delete'; currentPassword: FormDataEntryValue | null; username: FormDataEntryValue | null };
type FormError = ReturnType<typeof authError> | { message: string; field: 'confirmPassword' };

export const profileActionRequested = createEvent<ProfileAction>();
export const profileErrorCleared = createEvent();
const performProfileActionFx = createEffect(async ({ action, session }: { action: ProfileAction; session: ActiveSession }) => {
  const { id, username } = session.user;
  const signal = session.signal;
  switch (action.kind) {
    case 'logout':
      await authApi.logout(id, signal);
      return {};
    case 'password':
      if (action.newPassword !== action.confirmation) {
        return { error: { message: 'Повторите новый пароль точно как ввели его выше.', field: 'confirmPassword' } as const };
      }
      await authApi.changePassword(id, action.currentPassword, action.newPassword, signal);
      return { notice: 'Пароль изменён. Войдите с новым паролем.' };
    case 'delete':
      if (action.username !== username) {
        return { error: { message: 'Введите имя аккаунта точно как указано.', field: 'username' } as const };
      }
      await authApi.deleteAccount(id, username, action.currentPassword, signal);
      return { notice: 'Аккаунт удалён.' };
  }
});

const $pendingSession = createStore<ActiveSession | null>(null)
  .on(performProfileActionFx, (_, { session }) => session)
  .on(performProfileActionFx.finally, (current, { params }) => current === params.session ? null : current)
  .reset(sessionEnded);
export const $profilePending = combine($activeSession, $pendingSession, (active, pending) => active !== null && active === pending);

sample({
  clock: profileActionRequested,
  source: $activeSession,
  filter: combine($activeSession, $profilePending, (session, pending) => session !== null && !pending),
  fn: (session, action) => ({ session: session!, action }),
  target: performProfileActionFx,
});

const profileActionDone = sample({
  clock: performProfileActionFx.done,
  source: $activeSession,
  filter: (current, { params }) => current === params.session,
  fn: (_, done) => done,
});
const profileActionFailed = sample({
  clock: performProfileActionFx.fail,
  source: $activeSession,
  filter: (current, { params }) => current === params.session,
  fn: (_, { params, error }) => ({ session: params.session, error }),
});

export const $profileError = createStore<FormError | null>(null)
  .on(profileActionDone, (_, { result }) => result.error ?? null)
  .on(profileActionFailed, (_, { error }) => authError(error))
  .reset(performProfileActionFx, profileErrorCleared, sessionEnded);

sample({
  clock: profileActionDone,
  filter: ({ result }) => !result.error,
  fn: ({ params, result }) => ({ session: params.session, notice: result.notice }),
  target: sessionEndRequested,
});
sample({ clock: profileActionFailed, target: protectedRequestFailed });
