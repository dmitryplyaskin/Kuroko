import { Button, Loader, Stack, Text } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import type { User } from '@kuroko/contracts/auth';
import { ApiError } from '../shared/http/api';
import { authApi } from '../features/auth/authApi';
import { AuthForm } from '../features/auth/AuthForm';
import { GuestLayout } from './GuestLayout';
import { Workspace } from './Workspace';

type Session = User | { notice?: string } | 'loading' | 'unavailable';

export function App() {
  const [session, setSession] = useState<Session>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    authApi.session(controller.signal).then((user) => {
      if (!controller.signal.aborted) {
        setSession(user);
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setSession(error instanceof ApiError && error.status === 401 ? {} : 'unavailable');
      }
    });
    return () => controller.abort();
  }, [attempt]);

  const endSession = useCallback((notice?: string) => {
    setSession((current) => current === session ? { notice } : current);
  }, [session]);

  if (typeof session === 'object') {
    return 'id' in session
      ? <Workspace key={session.id} user={session} onSessionEnd={endSession} />
      : <GuestLayout><AuthForm onLogin={setSession} notice={session.notice} /></GuestLayout>;
  }

  return (
    <GuestLayout>
      <Stack className="auth-panel" gap="sm" align="flex-start">
        <h1>Вход в аккаунт</h1>
        {session === 'loading' ? (
          <output><Loader size="xs" mr="xs" aria-hidden="true" />Проверяем вход…</output>
        ) : (
          <>
            <Text role="alert">Не удалось проверить вход. Убедитесь, что сервер запущен.</Text>
            <Button onClick={() => { setSession('loading'); setAttempt(attempt + 1); }}>Повторить</Button>
          </>
        )}
      </Stack>
    </GuestLayout>
  );
}
