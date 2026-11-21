import { useI18n, type MessageKey } from '../../shared/i18n/i18n';
import { Button, Checkbox, Stack, Text, TextInput } from '@mantine/core';
import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, type SubmitEvent } from 'react';
import { useUnit } from 'effector-react';
import {
  $authError, $authPending, $registered, $registering, $username, authModeSwitched, authSubmitted, usernameChanged,
} from './authFormModel';
import './auth.css';

export function AuthForm({ notice }: { notice?: MessageKey }) {
  const { t } = useI18n();
  const { registering, username, pending, registered, error, submitCredentials, switchMode, setUsername } = useUnit({
    registering: $registering, username: $username, pending: $authPending, registered: $registered,
    error: $authError, submitCredentials: authSubmitted, switchMode: authModeSwitched, setUsername: usernameChanged,
  });
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = t('common.documentTitle', { title: t(registering ? 'auth.registrationPage' : 'auth.loginPage') });
  }, [registering, t]);

  useEffect(() => {
    (registered ? passwordInput : usernameInput).current?.focus();
  }, [registering, registered]);

  useEffect(() => {
    if (error?.field) {
      (error.field === 'username' ? usernameInput : passwordInput).current?.focus();
    }
  }, [error]);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    submitCredentials({ password: fields.get('password'), remember: fields.has('remember') });
  }

  const message = registered ? t('auth.accountCreated') : !registering && notice && t(notice);

  return (
    <div className="auth-panel">
      <Stack gap="xl">
        <div>
          <h1>{registering ? t('auth.createAccount') : t('auth.signInTitle')}</h1>
          <output>{message && <Text component="span" size="sm" c="dimmed">{message}</Text>}</output>
        </div>
        <Stack renderRoot={(props) => <form {...props} onSubmit={submit} />} gap="md">
          <TextInput
            ref={usernameInput}
            name="username"
            label={t('auth.username')}
            description={registering ? t('auth.usernameHint') : undefined}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={64}
            value={username}
            error={error?.field === 'username' && t(`error.${error.code}`)}
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
          <TextInput
            key={registering ? 'new-password' : 'current-password'}
            ref={passwordInput}
            type="password"
            name="password"
            label={t('auth.password')}
            autoComplete={registering ? 'new-password' : 'current-password'}
            description={registering ? t('auth.passwordHint') : undefined}
            required
            minLength={registering ? 12 : undefined}
            maxLength={128}
            error={error?.field === 'password' && t(`error.${error.code}`)}
          />
          {!registering && <Checkbox name="remember" label={t('auth.remember')} description={t('auth.rememberHint')} />}
          <div>
            <div role="alert">
              {error && !error.field && <Text c="var(--kr-danger)" size="sm" mb="sm">{t(`error.${error.code}`)}</Text>}
            </div>
            <Button
              type="submit" fullWidth size="md" loading={pending}
              rightSection={<ArrowRight size={17} aria-hidden="true" />}
            >
              {registering ? t('auth.register') : t('auth.login')}
            </Button>
          </div>
        </Stack>
        <div className="auth-switch">
          <span>{registering ? t('auth.haveAccount') : t('auth.noAccount')}</span>
          <button type="button" className="text-button" onClick={switchMode} disabled={pending}>
            {registering ? t('auth.login') : t('auth.register')}
          </button>
        </div>
      </Stack>
    </div>
  );
}
