import { Button, Loader, Stack, Text } from '@mantine/core';
import { useUnit } from 'effector-react';
import { $session, sessionRetryRequested } from '../features/auth/sessionModel';
import { AuthForm } from '../features/auth/AuthForm';
import { GuestLayout } from './GuestLayout';
import { Workspace } from './Workspace';

export function App() {
  const [session, retry] = useUnit([$session, sessionRetryRequested]);

  if (session.status === 'authenticated') {
    const { user } = session.session;
    return <Workspace key={user.id} user={user} />;
  }

  if (session.status === 'guest') {
    return <GuestLayout><AuthForm notice={session.notice} /></GuestLayout>;
  }

  return (
    <GuestLayout>
      <Stack className="auth-panel" gap="sm" align="flex-start">
        <h1>Вход в аккаунт</h1>
        {session.status === 'loading' ? (
          <output><Loader size="xs" mr="xs" aria-hidden="true" />Проверяем вход…</output>
        ) : (
          <>
            <Text role="alert">Не удалось проверить вход. Убедитесь, что сервер запущен.</Text>
            <Button onClick={retry}>Повторить</Button>
          </>
        )}
      </Stack>
    </GuestLayout>
  );
}
