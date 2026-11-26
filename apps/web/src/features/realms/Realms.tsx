import { defaultRealmFilters } from '@kuroko/contracts/realms';
import { Button } from '@mantine/core';
import { useUnit } from 'effector-react';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { $activeSession } from '../../platform/session/model';
import { useI18n } from '../../shared/i18n/i18n';
import { $realmEditor, realmEditorClosed, realmEditorCreated, realmEditorOpened, realmLoadRetried } from './model';
import { RealmEditor } from './RealmEditor';
import { RealmLibrary, type LibraryCriteria } from './RealmLibrary';
import './realms.css';

export default function Realms() {
  const { t } = useI18n();
  const { session, view, create, open, close, retry } = useUnit({
    session: $activeSession, view: $realmEditor, create: realmEditorCreated, open: realmEditorOpened,
    close: realmEditorClosed, retry: realmLoadRetried,
  });
  const [criteria, setCriteria] = useState<LibraryCriteria>({ q: '', sort: 'updated', offset: 0, filters: defaultRealmFilters });
  const container = useRef<HTMLDivElement>(null);

  const editing = view !== null;
  useEffect(() => {
    container.current?.querySelector('h1')?.focus();
  }, [editing]);

  if (!session) return null;
  return (
    <div className="realms-page" ref={container}>
      {!view ? <RealmLibrary session={session} criteria={criteria} onCriteria={setCriteria}
        onCreate={() => create(undefined)} onOpen={open} onImport={create} />
        : view.status === 'ready' ? <RealmEditor session={session} editor={view} />
        : <>
          <button type="button" className="realms-back" onClick={close}><ArrowLeft size={16} aria-hidden="true" />{t('realms.back')}</button>
          <header className="page-heading realms-heading"><h1 tabIndex={-1}>{t('realms.label')}</h1></header>
          {view.status === 'error' ? <div className="realms-state">
            <p role="alert">{t(`error.${view.code}`)}</p>
            <Button variant="default" onClick={retry}>{t('common.retryLoad')}</Button>
          </div> : <output className="realms-muted">{t('realms.loadingDetail')}</output>}
        </>}
    </div>
  );
}
