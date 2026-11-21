import { Button, Checkbox, Stack, Text, TextInput } from '@mantine/core';
import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import type { AuthField, User } from '@kuroko/contracts/auth';
import { authApi, authError } from './authApi';
import './auth.css';

export function AuthForm({ onLogin, notice }: { onLogin: (user: User) => void; notice?: string }) {
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [pending, setPending] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<{ message: string; field?: AuthField }>();
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = registering ? 'Регистрация · Kuroko' : 'Вход · Kuroko';
    (registered ? passwordInput : usernameInput).current?.focus();
  }, [registering, registered]);

  useEffect(() => {
    if (error?.field) {
      (error.field === 'username' ? usernameInput : passwordInput).current?.focus();
    }
  }, [error]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = fields.get('password');
    setPending(true);
    setError(undefined);
    try {
      if (registering) {
        const user = await authApi.register(username, password);
        setUsername(user.username);
        setRegistering(false);
        setRegistered(true);
      } else {
        const user = await authApi.login(username, password, fields.has('remember'));
        onLogin(user);
      }
    } catch (failure) {
      setError(authError(failure));
    } finally {
      setPending(false);
    }
  }

  function switchMode() {
    setRegistering(!registering);
    setRegistered(false);
    setError(undefined);
  }

  const message = registered ? 'Аккаунт создан. Введите пароль, чтобы войти.' : !registering && notice;

  return (
    <div className="auth-panel">
      <Stack gap="xl">
        <div>
          <h1>{registering ? 'Создать аккаунт' : 'Вход в аккаунт'}</h1>
          <output>{message && <Text component="span" size="sm" c="dimmed">{message}</Text>}</output>
        </div>
        <Stack renderRoot={(props) => <form {...props} onSubmit={submit} />} gap="md">
          <TextInput
            ref={usernameInput}
            name="username"
            label="Имя пользователя"
            description={registering ? 'От 3 до 32 букв, цифр или символов . _ -' : undefined}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={64}
            value={username}
            error={error?.field === 'username' && error.message}
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
          <TextInput
            key={registering ? 'new-password' : 'current-password'}
            ref={passwordInput}
            type="password"
            name="password"
            label="Пароль"
            autoComplete={registering ? 'new-password' : 'current-password'}
            description={registering ? 'Не менее 12 символов' : undefined}
            required
            minLength={registering ? 12 : undefined}
            maxLength={128}
            error={error?.field === 'password' && error.message}
          />
          {!registering && <Checkbox name="remember" label="Автовход" description="Запомнить вход на 30 дней" />}
          <div>
            <div role="alert">
              {error && !error.field && <Text c="var(--kr-danger)" size="sm" mb="sm">{error.message}</Text>}
            </div>
            <Button
              type="submit" fullWidth size="md" loading={pending}
              rightSection={<ArrowRight size={17} aria-hidden="true" />}
            >
              {registering ? 'Зарегистрироваться' : 'Войти'}
            </Button>
          </div>
        </Stack>
        <div className="auth-switch">
          <span>{registering ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}</span>
          <button type="button" className="text-button" onClick={switchMode} disabled={pending}>
            {registering ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </div>
      </Stack>
    </div>
  );
}
