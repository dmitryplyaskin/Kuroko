import { useEffect } from 'react';
import { useI18n } from '../shared/i18n/i18n';
import { Button, Loader, Stack, Text } from '@mantine/core';
import { useUnit } from 'effector-react';
import type { ModuleRegistry } from '../modules/registry';
import { $session, sessionRetryRequested } from '../platform/session/model';
import { AuthForm } from './account/AuthForm';
import { GuestLayout } from './GuestLayout';
import { Workspace } from './Workspace';
import type { WorkspaceModel } from './workspaceModel';

export function App({ registry, workspace }: { registry: ModuleRegistry; workspace: WorkspaceModel }) {
  const { locale, t } = useI18n();
  const [session, retry] = useUnit([$session, sessionRetryRequested]);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    if (session.status === 'loading' || session.status === 'unavailable') {
      document.title = t('common.documentTitle', { title: t('auth.loginPage') });
    }
  }, [session.status, t]);

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
        <h1>{t('auth.signInTitle')}</h1>
        {session.status === 'loading' ? (
          <output><Loader size="xs" mr="xs" aria-hidden="true" />{t('auth.checking')}</output>
        ) : (
          <>
            <Text role="alert">{t('error.session_check_failed')}</Text>
            <Button onClick={retry}>{t('common.retry')}</Button>
          </>
        )}
      </Stack>
    </GuestLayout>
  );
}
