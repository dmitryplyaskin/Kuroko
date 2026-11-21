import { isAuthField, type User } from '@kuroko/contracts/auth';
import { api, ApiError, errorMessage } from '../../shared/http/api';

export const authApi = {
  session: (signal?: AbortSignal) => api<User>('/auth/session', { signal }),
  register: (username: string, password: FormDataEntryValue | null) =>
    api<User>('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username: string, password: FormDataEntryValue | null, remember: boolean) =>
    api<User>('/auth/login', { method: 'POST', body: { username, password, remember } }),
  logout: (account: number, signal: AbortSignal) => api<void>('/auth/logout', { method: 'POST', account, signal }),
  changePassword: (account: number, currentPassword: FormDataEntryValue | null, newPassword: FormDataEntryValue | null, signal: AbortSignal) =>
    api<void>('/auth/password', { method: 'PUT', account, signal, body: { currentPassword, newPassword } }),
  deleteAccount: (account: number, username: string, currentPassword: FormDataEntryValue | null, signal: AbortSignal) =>
    api<void>('/auth/account', { method: 'DELETE', account, signal, body: { username, currentPassword } }),
};

export function authError(failure: unknown) {
  return {
    message: errorMessage(failure),
    field: failure instanceof ApiError && isAuthField(failure.field) ? failure.field : undefined,
  };
}
