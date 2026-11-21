import { LocalizedText } from '../../shared/i18n/LocalizedText';
import { useI18n } from '../../shared/i18n/i18n';
import { Button, Group, Modal, TextInput } from '@mantine/core';
import { ChevronRight, KeyRound, LogOut, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useUnit } from 'effector-react';
import type { User } from '@kuroko/contracts/auth';
import { $profileError, $profilePending, profileActionRequested, profileErrorCleared } from './profileModel';
import './profile.css';

type ProfileView = 'overview' | 'password' | 'delete';
const titles = { overview: 'profile.label', password: 'profile.changePassword', delete: 'profile.deleteAccount' } as const;

export function Profile({ user }: { user: User }) {
  const { locale, t } = useI18n();
  const [opened, setOpened] = useState(false);
  const [view, setView] = useState<ProfileView>('overview');
  const [pending, error, perform, clearError] = useUnit([
    $profilePending, $profileError, profileActionRequested, profileErrorCleared,
  ]);
  const firstAction = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const initial = Array.from(user.username)[0]?.toLocaleUpperCase(locale);
  const deleting = view === 'delete';

  useEffect(() => {
    if (opened) {
      const target = view === 'overview' ? firstAction.current : form.current?.querySelector<HTMLElement>('[data-autofocus]');
      target?.focus();
    }
  }, [opened, view]);

  useEffect(() => {
    if (error?.field) {
      form.current?.querySelector<HTMLInputElement>(`input[name="${error.field}"]`)?.focus();
    }
  }, [error]);

  function show(nextView: ProfileView) {
    clearError();
    setView(nextView);
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const currentPassword = fields.get('currentPassword');
    perform(deleting
      ? { kind: 'delete', currentPassword, username: fields.get('username') }
      : { kind: 'password', currentPassword, newPassword: fields.get('newPassword'), confirmation: fields.get('confirmPassword') });
  }

  return (
    <div className="workspace-profile">
      <button type="button" className="profile-trigger" aria-label={t('profile.userLabel', { username: user.username })} aria-haspopup="dialog"
        title={t('profile.label')} onClick={() => { show('overview'); setOpened(true); }}>
        <span className="icon-tile account-avatar" aria-hidden="true"><UserRound size={16} /></span>
        <span className="profile-trigger-name">{user.username}</span>
        <ChevronRight className="profile-trigger-arrow" size={15} aria-hidden="true" />
      </button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={t(titles[view])} size={420}
        closeOnEscape={!pending} closeOnClickOutside={!pending} closeButtonProps={{ 'aria-label': t('common.close'), disabled: pending }}>
        {view === 'overview' ? (
          <div className="profile-overview">
            <div className="profile-identity">
              <span className="icon-tile account-avatar" aria-hidden="true">{initial}</span>
              <strong>{user.username}</strong>
            </div>
            <div className="profile-actions">
              <button type="button" className="profile-action" ref={firstAction} data-autofocus onClick={() => show('password')} disabled={pending}>
                <KeyRound size={17} aria-hidden="true" />{t('profile.changePassword')}<ChevronRight size={15} aria-hidden="true" />
              </button>
              <button type="button" className="profile-action" onClick={() => perform({ kind: 'logout' })} disabled={pending}>
                <LogOut size={17} aria-hidden="true" />{t('profile.signOut')}
              </button>
              <button type="button" className="profile-action profile-action-danger" onClick={() => show('delete')} disabled={pending}>
                <Trash2 size={17} aria-hidden="true" />{t('profile.deleteAccount')}<ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
            <div role="alert" className="profile-error">{error && t(`error.${error.code}`)}</div>
          </div>
        ) : (
          <form className="profile-form" key={view} ref={form} onSubmit={submit}>
            {deleting ? (
              <>
                <p>{t('profile.deleteWarning')}</p>
                <TextInput name="username" label={t('profile.accountName')} description={<LocalizedText id="profile.confirmName" values={{ username: <strong>{user.username}</strong> }} />}
                  autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} required readOnly={pending}
                  data-autofocus error={error?.field === 'username' && t(`error.${error.code}`)} />
              </>
            ) : (
              <p>{t('profile.passwordWarning')}</p>
            )}
            <TextInput type="password" name="currentPassword" label={t('profile.currentPassword')} autoComplete="current-password"
              data-autofocus={!deleting || undefined} maxLength={128} required readOnly={pending}
              error={error?.field === 'currentPassword' && t(`error.${error.code}`)} />
            {!deleting && (
              <>
                <TextInput type="password" name="newPassword" label={t('profile.newPassword')} description={t('profile.newPasswordHint')}
                  autoComplete="new-password" minLength={12} maxLength={128} required readOnly={pending}
                  error={error?.field === 'newPassword' && t(`error.${error.code}`)} />
                <TextInput type="password" name="confirmPassword" label={t('profile.confirmPassword')} autoComplete="new-password"
                  minLength={12} maxLength={128} required readOnly={pending}
                  error={error?.field === 'confirmPassword' && t(`error.${error.code}`)} />
              </>
            )}
            <div>
              <div role="alert" className="profile-error">{!error?.field && error && t(`error.${error.code}`)}</div>
              <Group gap="sm" justify="flex-end">
                <Button type="button" variant="default" disabled={pending} onClick={() => show('overview')}>{t('common.cancel')}</Button>
                <Button type="submit" color={deleting ? 'red' : undefined} loading={pending}>
                  {deleting ? t('profile.deleteAccount') : t('profile.savePassword')}
                </Button>
              </Group>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
