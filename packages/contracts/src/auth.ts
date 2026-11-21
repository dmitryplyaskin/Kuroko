export type User = { id: number; username: string };
export type AuthField = 'username' | 'password' | 'currentPassword' | 'newPassword';

export function isAuthField(value: unknown): value is AuthField {
  return value === 'username' || value === 'password' || value === 'currentPassword' || value === 'newPassword';
}
