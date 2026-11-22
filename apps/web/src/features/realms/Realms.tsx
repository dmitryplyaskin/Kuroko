import { defaultRealmFilters, type SavedRealm } from '@kuroko/contracts/realms';
import { Button } from '@mantine/core';
import { useUnit } from 'effector-react';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { $activeSession, type ActiveSession } from '../../platform/session/model';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { useI18n } from '../../shared/i18n/i18n';
import { loadRealmFx } from './model';
import { RealmEditor } from './RealmEditor';
import { RealmLibrary, type LibraryCriteria } from './RealmLibrary';
import type { ImportedRealm } from './realmFile';
import './realms.css';

type View = { kind: 'library' } | { kind: 'editor'; id?: string; imported?: ImportedRealm };

export default function Realms() {
  const session = useUnit($activeSession);
  const [view, setView] = useState<View>({ kind: 'library' });
  const [criteria, setCriteria] = useState<LibraryCriteria>({ q: '', sort: 'updated', offset: 0, filters: defaultRealmFilters });
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    container.current?.querySelector('h1')?.focus();
  }, [view.kind]);

  if (!session) return null;
  return (
    <div className="realms-page" ref={container}>
      {view.kind === 'library' ? <RealmLibrary session={session} criteria={criteria} onCriteria={setCriteria}
        onCreate={() => setView({ kind: 'editor' })} onOpen={(id) => setView({ kind: 'editor', id })}
        onImport={(imported) => setView({ kind: 'editor', imported })} />
        : <OpenRealm key={view.id ?? 'new'} session={session} id={view.id} imported={view.imported}
          onClose={() => setView({ kind: 'library' })} />}
    </div>
  );
}

function OpenRealm({ session, id, imported, onClose }: {
  session: ActiveSession; id?: string; imported?: ImportedRealm; onClose: () => void;
}) {
  const { t } = useI18n();
  const load = useUnit(loadRealmFx);
  const [saved, setSaved] = useState<SavedRealm | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!id || saved) return;
    const controller = new AbortController();
    const { signal } = controller;
    void load({ session, signal, id }).then((result) => {
      if (!signal.aborted && !session.signal.aborted) setSaved(result);
    }, (failure: unknown) => {
      if (!signal.aborted && !session.signal.aborted) setError(errorCode(failure));
    });
    return () => controller.abort();
  }, [id, load, retry, saved, session]);

  if (!id || saved) return <RealmEditor session={session} initialSaved={saved ?? undefined} imported={imported} onClose={onClose} />;
  return <>
    <button type="button" className="realms-back" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />{t('realms.back')}</button>
    <header className="page-heading realms-heading"><h1 tabIndex={-1}>{t('realms.label')}</h1></header>
    {error ? <div className="realms-state">
      <p role="alert">{t(`error.${error}`)}</p>
      <Button variant="default" onClick={() => { setError(null); setRetry((value) => value + 1); }}>{t('common.retryLoad')}</Button>
    </div> : <output className="realms-muted">{t('realms.loadingDetail')}</output>}
  </>;
}
