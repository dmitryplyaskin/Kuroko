import { Button } from '@mantine/core';
import { useUnit } from 'effector-react';
import { Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { $activeSession } from '../../platform/session/model';
import { useI18n } from '../../shared/i18n/i18n';
import { LocalizedText } from '../../shared/i18n/LocalizedText';
import { $toolSettings } from '../tools/model';
import { AgentEditor } from './AgentEditor';
import { $agentEditing, $agentLibrary, $agentRemoved, agentEditorOpened, agentsOpened } from './model';
import './agents.css';

export default function Agents() {
  const { t, locale } = useI18n();
  const [library, session, settings, open, editing, removed, edit] = useUnit([
    $agentLibrary, $activeSession, $toolSettings, agentsOpened, $agentEditing, $agentRemoved, agentEditorOpened,
  ]);
  const content = useRef<HTMLElement>(null);
  useEffect(() => { open(); }, [open, session]);
  useEffect(() => { content.current?.querySelector('h1')?.focus(); }, [editing]);

  const ready = library.status === 'ready';
  const agents = library.agents.toSorted((a, b) => a.name.localeCompare(b.name, locale));
  const setupNeeded = settings.status === 'ready' && (!settings.enabled.includes('subagent') || !settings.subagent?.presetId);

  return <section ref={content} className="agents-page" aria-labelledby="agents-title">
    {editing && session ? <AgentEditor session={session} /> : <>
      <header className="page-heading agents-heading">
        <div>
          <h1 id="agents-title" tabIndex={-1}>{t('agents.label')}</h1>
          <p>{t('agents.description')}</p>
        </div>
        {ready && <Button leftSection={<Plus size={16} strokeWidth={1.5} aria-hidden="true" />} onClick={() => edit(undefined)}>
          {t('agents.create')}
        </Button>}
      </header>
      {setupNeeded && <p className="agents-setup">
        <LocalizedText id="agents.setup" values={{ tools: <a href="#tools">{t('tools.label')}</a> }} />
      </p>}
      <output className="agents-status">
        {(library.status === 'idle' || library.status === 'loading') && t('agents.loading')}
        {removed && t('agents.removed')}
      </output>
      {library.error && <div className="agents-load-error">
        <p className="agents-error" role="alert">{t(`error.${library.error}`)}</p>
        <Button variant="default" onClick={open}>{t('common.retryLoad')}</Button>
      </div>}
      {ready && (agents.length ? <ul className="agents-list">
        {agents.map((agent) => <li className="agents-row" key={agent.id}>
          <div className="agents-copy">
            <h2><bdi>{agent.name}</bdi></h2>
            <p id={`agent-description-${agent.id}`} dir="auto">{agent.description}</p>
          </div>
          <Button variant="default" aria-label={t('agents.editNamed', { name: agent.name })}
            aria-describedby={`agent-description-${agent.id}`} onClick={() => edit(agent)}>
            {t('agents.edit')}
          </Button>
        </li>)}
      </ul> : <p className="agents-empty">{t('agents.empty')}</p>)}
    </>}
  </section>;
}
