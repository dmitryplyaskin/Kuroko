import { isAuthField, type User } from '@kuroko/contracts/auth';
import { api, ApiError, errorCode } from '../../shared/http/api';
import type { ActiveSession } from './model';
import { sessionRequest } from './request';

export const authApi = {
  session: (signal?: AbortSignal) => api<User>('/auth/session', { signal }),
  register: (username: string, password: FormDataEntryValue | null) =>
    api<User>('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username: string, password: FormDataEntryValue | null, remember: boolean) =>
    api<User>('/auth/login', { method: 'POST', body: { username, password, remember } }),
  logout: (session: ActiveSession) => sessionRequest<void>(session, '/auth/logout', { method: 'POST' }),
  changePassword: (session: ActiveSession, currentPassword: FormDataEntryValue | null, newPassword: FormDataEntryValue | null) =>
    sessionRequest<void>(session, '/auth/password', { method: 'PUT', body: { currentPassword, newPassword } }),
  deleteAccount: (session: ActiveSession, username: string, currentPassword: FormDataEntryValue | null) =>
    sessionRequest<void>(session, '/auth/account', { method: 'DELETE', body: { username, currentPassword } }),
};

export function authError(failure: unknown) {
  return {
    code: errorCode(failure),
    field: failure instanceof ApiError && isAuthField(failure.field) ? failure.field : undefined,
  };
}
