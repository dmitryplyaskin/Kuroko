import { Button, Loader, Stack, Text } from '@mantine/core';
import { useUnit } from 'effector-react';
import type { ModuleRegistry } from '../modules/registry';
import { $session, sessionRetryRequested } from '../platform/session/model';
import { AuthForm } from './account/AuthForm';
import { GuestLayout } from './GuestLayout';
import { Workspace } from './Workspace';
import type { WorkspaceModel } from './workspaceModel';

export function App({ registry, workspace }: { registry: ModuleRegistry; workspace: WorkspaceModel }) {
  const [session, retry] = useUnit([$session, sessionRetryRequested]);

  if (session.status === 'authenticated') {
    const { user } = session.session;
    return <Workspace key={user.id} user={user} registry={registry} model={workspace} />;
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
