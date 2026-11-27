import { Button } from '@mantine/core';
import { useUnit } from 'effector-react';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { $activeSession } from '../../platform/session/model';
import { useI18n } from '../../shared/i18n/i18n';
import library from '../../shared/library/Library.module.css';
import { $personaEditor, personaClosed, personaOpened } from './editorModel';
import { PersonaEditor } from './PersonaEditor';
import { PersonaLibrary } from './PersonaLibrary';
import classes from './Personas.module.css';

export default function Personas() {
  const { t } = useI18n();
  const [session, editor, close, open] = useUnit([$activeSession, $personaEditor, personaClosed, personaOpened]);
  const container = useRef<HTMLDivElement>(null);
  const status = editor?.status;
  useEffect(() => { container.current?.querySelector('h1')?.focus(); }, [status]);

  if (!session) return null;
  return <div className={classes.page} ref={container}>
    {!editor ? <PersonaLibrary session={session} /> : editor.status === 'ready' ? <PersonaEditor editor={editor} /> : <>
      <Button variant="subtle" className={classes.back} leftSection={<ArrowLeft size={16} aria-hidden="true" />}
        onClick={close}>{t('personas.back')}</Button>
      <header className="page-heading"><h1 tabIndex={-1}>{t('personas.label')}</h1></header>
      {editor.status === 'loading' ? <output className={library['library-message']}>{t('personas.loadingDetail')}</output>
        : <div className={`${library['library-message']} ${library['library-state']}`}>
          <p className={classes.error} role="alert">{t(`error.${editor.code}`)}</p>
          {editor.code !== 'persona_not_found' && <Button variant="default" onClick={() => open(editor.id)}>{t('common.retryLoad')}</Button>}
        </div>}
    </>}
  </div>;
}
