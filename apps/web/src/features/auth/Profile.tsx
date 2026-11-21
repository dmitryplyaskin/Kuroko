import { Button, Group, Modal, TextInput } from '@mantine/core';
import { ChevronRight, KeyRound, LogOut, Trash2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import type { AuthField, User } from '@kuroko/contracts/auth';
import { ApiError } from '../../shared/http/api';
import { authApi, authError } from './authApi';
import './profile.css';

type ProfileView = 'overview' | 'password' | 'delete';
type FormError = { message: string; field?: AuthField | 'confirmPassword' };

const titles = { overview: 'Профиль', password: 'Сменить пароль', delete: 'Удалить аккаунт' };

export function Profile({ user, onSessionEnd }: { user: User; onSessionEnd: (notice?: string) => void }) {
  const [opened, setOpened] = useState(false);
  const [view, setView] = useState<ProfileView>('overview');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FormError>();
  const firstAction = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const initial = Array.from(user.username)[0]?.toLocaleUpperCase('ru');
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
    setError(undefined);
    setView(nextView);
  }

  async function perform(action: () => Promise<void>, notice?: string) {
    if (pending) return;
    setError(undefined);
    setPending(true);
    try {
      await action();
      onSessionEnd(notice);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        onSessionEnd();
      } else {
        setError(authError(failure));
      }
    } finally {
      setPending(false);
    }
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const fields = new FormData(event.currentTarget);
    const currentPassword = fields.get('currentPassword');
    if (deleting) {
      const username = fields.get('username');
      if (username !== user.username) {
        setError({ message: 'Введите имя аккаунта точно как указано.', field: 'username' });
        return;
      }
      await perform(() => authApi.deleteAccount(user.id, username, currentPassword), 'Аккаунт удалён.');
      return;
    }

    const newPassword = fields.get('newPassword');
    if (newPassword !== fields.get('confirmPassword')) {
      setError({ message: 'Повторите новый пароль точно как ввели его выше.', field: 'confirmPassword' });
      return;
    }
    await perform(() => authApi.changePassword(user.id, currentPassword, newPassword), 'Пароль изменён. Войдите с новым паролем.');
  }

  return (
    <div className="workspace-profile">
      <button type="button" className="profile-trigger" aria-label={`Профиль ${user.username}`} aria-haspopup="dialog"
        title="Профиль" onClick={() => { show('overview'); setOpened(true); }}>
        <span className="icon-tile account-avatar" aria-hidden="true"><UserRound size={16} /></span>
        <span className="profile-trigger-name">{user.username}</span>
        <ChevronRight className="profile-trigger-arrow" size={15} aria-hidden="true" />
      </button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={titles[view]} size={420}
        closeOnEscape={!pending} closeOnClickOutside={!pending} closeButtonProps={{ 'aria-label': 'Закрыть', disabled: pending }}>
        {view === 'overview' ? (
          <div className="profile-overview">
            <div className="profile-identity">
              <span className="icon-tile account-avatar" aria-hidden="true">{initial}</span>
              <strong>{user.username}</strong>
            </div>
            <div className="profile-actions">
              <button type="button" className="profile-action" ref={firstAction} data-autofocus onClick={() => show('password')} disabled={pending}>
                <KeyRound size={17} aria-hidden="true" />Сменить пароль<ChevronRight size={15} aria-hidden="true" />
              </button>
              <button type="button" className="profile-action" onClick={() => perform(() => authApi.logout(user.id))} disabled={pending}>
                <LogOut size={17} aria-hidden="true" />Выйти
              </button>
              <button type="button" className="profile-action profile-action-danger" onClick={() => show('delete')} disabled={pending}>
                <Trash2 size={17} aria-hidden="true" />Удалить аккаунт<ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
            <div role="alert" className="profile-error">{error?.message}</div>
          </div>
        ) : (
          <form className="profile-form" key={view} ref={form} onSubmit={submit}>
            {deleting ? (
              <>
                <p>Аккаунт и его секреты будут удалены без возможности восстановления.</p>
                <TextInput name="username" label="Имя аккаунта" description={<>Введите <strong>{user.username}</strong></>}
                  autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} required readOnly={pending}
                  data-autofocus error={error?.field === 'username' && error.message} />
              </>
            ) : (
              <p>После смены пароля потребуется заново войти на всех устройствах.</p>
            )}
            <TextInput type="password" name="currentPassword" label="Текущий пароль" autoComplete="current-password"
              data-autofocus={!deleting || undefined} maxLength={128} required readOnly={pending}
              error={error?.field === 'currentPassword' && error.message} />
            {!deleting && (
              <>
                <TextInput type="password" name="newPassword" label="Новый пароль" description="От 12 до 128 символов"
                  autoComplete="new-password" minLength={12} maxLength={128} required readOnly={pending}
                  error={error?.field === 'newPassword' && error.message} />
                <TextInput type="password" name="confirmPassword" label="Повторите новый пароль" autoComplete="new-password"
                  minLength={12} maxLength={128} required readOnly={pending}
                  error={error?.field === 'confirmPassword' && error.message} />
              </>
            )}
            <div>
              <div role="alert" className="profile-error">{!error?.field && error?.message}</div>
              <Group gap="sm" justify="flex-end">
                <Button type="button" variant="default" disabled={pending} onClick={() => show('overview')}>Отмена</Button>
                <Button type="submit" color={deleting ? 'red' : undefined} loading={pending}>
                  {deleting ? 'Удалить аккаунт' : 'Сохранить пароль'}
                </Button>
              </Group>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
