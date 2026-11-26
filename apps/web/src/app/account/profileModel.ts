import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import { authApi, authError } from '../../platform/session/authApi';
import { $activeSession, inActiveSession, protectedRequestFailed, sessionEnded, sessionEndRequested, type ActiveSession } from '../../platform/session/model';

type ProfileAction = { kind: 'logout' }
  | { kind: 'password'; currentPassword: FormDataEntryValue | null; newPassword: FormDataEntryValue | null; confirmation: FormDataEntryValue | null }
  | { kind: 'delete'; currentPassword: FormDataEntryValue | null; username: FormDataEntryValue | null };
type FormError = ReturnType<typeof authError> | { code: 'password_confirmation_mismatch'; field: 'confirmPassword' };

export const profileActionRequested = createEvent<ProfileAction>();
export const profileErrorCleared = createEvent();
const performProfileActionFx = createEffect(async ({ action, session }: { action: ProfileAction; session: ActiveSession }) => {
  const { username } = session.user;
  switch (action.kind) {
    case 'logout':
      await authApi.logout(session);
      return {};
    case 'password':
      if (action.newPassword !== action.confirmation) {
        return { error: { code: 'password_confirmation_mismatch', field: 'confirmPassword' } as const };
      }
      await authApi.changePassword(session, action.currentPassword, action.newPassword);
      return { notice: 'profile.passwordChanged' as const };
    case 'delete':
      if (action.username !== username) {
        return { error: { code: 'account_name_mismatch', field: 'username' } as const };
      }
      await authApi.deleteAccount(session, username, action.currentPassword);
      return { notice: 'profile.accountDeleted' as const };
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

const profileActionDone = inActiveSession(performProfileActionFx.done, ({ session }) => session);
const profileActionFailed = inActiveSession(performProfileActionFx.fail, ({ session }) => session)
  .map(({ params, error }) => ({ session: params.session, error }));

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
