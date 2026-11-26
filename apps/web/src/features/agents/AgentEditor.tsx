import { Button, Modal, Tabs, TextInput } from '@mantine/core';
import { agentDescriptionLimit, agentInstructionsLimit, readAgent, type AgentDraft, type AgentField, type SavedAgent } from '@kuroko/contracts/agents';
import { subagentNameLimit } from '@kuroko/contracts/tools';
import { useUnit } from 'effector-react';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ActiveSession } from '../../platform/session/model';
import { ApiError, errorCode, type ErrorCode } from '../../shared/http/api';
import { useI18n } from '../../shared/i18n/i18n';
import { PromptTextarea } from '../../shared/prompt-templates/TemplateHelp';
import { insertPromptCode, PromptTemplateControls } from '../instructions/PromptTemplateControls';
import { AgentTools } from './AgentTools';
import { removeAgentFx, saveAgentFx } from './model';

const emptyDraft: AgentDraft = { name: '', description: '', instructions: '', tools: [] };

export function AgentEditor({ session, initialAgent, onClose }: {
  session: ActiveSession;
  initialAgent?: SavedAgent;
  onClose: (deleted?: boolean) => void;
}) {
  const { t, number } = useI18n();
  const [save, remove, saving, removing] = useUnit([saveAgentFx, removeAgentFx, saveAgentFx.pending, removeAgentFx.pending]);
  const [agent, setAgent] = useState(initialAgent);
  const [draft, setDraft] = useState<AgentDraft & Pick<SavedAgent, 'worldTitle'>>(initialAgent ?? emptyDraft);
  const [tab, setTab] = useState('definition');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<ErrorCode>();
  const [issue, setIssue] = useState<{ field?: AgentField; message: string }>();
  const [saved, setSaved] = useState(false);
  const fields = useRef<Partial<Record<AgentField, HTMLElement | null>>>({});
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const busy = saving || removing;
  const baseline = agent ?? emptyDraft;
  const dirty = draft.name !== baseline.name || draft.description !== baseline.description || draft.instructions !== baseline.instructions ||
    (draft.worldId ?? null) !== (baseline.worldId ?? null) ||
    draft.tools.length !== baseline.tools.length || draft.tools.some((id) => !baseline.tools.includes(id));

  useEffect(() => {
    if (!dirty) return;
    const confirmUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', confirmUnload);
    return () => window.removeEventListener('beforeunload', confirmUnload);
  }, [dirty]);

  function change(patch: Partial<AgentDraft & Pick<SavedAgent, 'worldTitle'>>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
    if (issue?.field && (Object.hasOwn(patch, issue.field) || (issue.field === 'instructions' && Object.hasOwn(patch, 'worldId')))) setIssue(undefined);
  }

  function invalid(field: AgentField, message: string) {
    setIssue({ field, message });
    setTab(field === 'tools' ? 'tools' : 'definition');
    requestAnimationFrame(() => fields.current[field]?.focus());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || confirmLeave || confirmDelete) return;
    const result = readAgent(draft);
    if ('field' in result) {
      invalid(result.field, t(`agents.invalid.${result.field}`));
      return;
    }
    setIssue(undefined);
    if (agent && !dirty) { setSaved(true); return; }
    try {
      const updated = await save({ session, id: agent?.id, draft: result.draft });
      if (session.signal.aborted) return;
      setAgent(updated);
      setDraft(updated);
      setSaved(true);
    } catch (error) {
      if (session.signal.aborted) return;
      const code = errorCode(error);
      if (code === 'agent_invalid' && error instanceof ApiError && ['name', 'description', 'instructions', 'tools'].includes(error.field ?? '')) {
        const field = error.field as AgentField;
        invalid(field, t(`agents.invalid.${field}`));
      } else if (code === 'prompt_template_invalid') {
        const line = error instanceof ApiError ? error.field : undefined;
        invalid('instructions', line ? t('templates.lineError', { line }) : t('error.prompt_template_invalid'));
      } else setIssue({ message: t(`error.${code}`) });
    }
  }

  async function removeAgent() {
    if (!agent || busy) return;
    setDeleteError(undefined);
    try {
      await remove({ session, id: agent.id });
      if (!session.signal.aborted) onClose(true);
    } catch (error) {
      if (!session.signal.aborted) setDeleteError(errorCode(error));
    }
  }

  function showLeaveConfirmation() {
    setConfirmLeave(true);
    setIssue(undefined);
    requestAnimationFrame(() => keepButton.current?.focus());
  }

  function resumeEditing() {
    setConfirmLeave(false);
    setIssue(undefined);
    requestAnimationFrame(() => backButton.current?.focus());
  }

  function textCount(value: string, limit: number) {
    return t('agents.textCount', { count: number.format(value.length), limit: number.format(limit) });
  }

  return <form className="agent-editor" noValidate onSubmit={(event) => void submit(event)}>
    <div className="agent-editor-bar">
      <header className="page-heading agent-editor-heading">
        <Button className="agent-back" ref={backButton} type="button" variant="subtle" disabled={busy || confirmLeave}
          leftSection={<ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />}
          onClick={() => dirty ? showLeaveConfirmation() : onClose()}>{t('agents.back')}</Button>
        <h1 id="agents-title" tabIndex={-1}>{agent ? <bdi>{agent.name}</bdi> : t('agents.create')}</h1>
      </header>
      <div className="agent-editor-actions">
        <output className="agent-save-status">{saved && t('agents.saved')}</output>
        <Button type="submit" loading={saving} disabled={confirmLeave}>{t('common.save')}</Button>
      </div>
    </div>
    {issue && !issue.field && <p className="agents-error agent-editor-error" role="alert">{issue.message}</p>}
    {confirmLeave && <section className="agent-confirmation" aria-labelledby="agent-confirm-title">
      <h2 id="agent-confirm-title">{t('agents.discardTitle')}</h2>
      <p>{t('agents.discardBody')}</p>
      <div className="agent-confirm-actions">
        <Button ref={keepButton} type="button" variant="default" disabled={busy} onClick={resumeEditing}>{t('agents.keepEditing')}</Button>
        <Button type="button" color="red" onClick={() => onClose()}>{t('agents.discard')}</Button>
      </div>
    </section>}
    <div hidden={confirmLeave}>
      <Tabs className="agent-editor-tabs" value={tab} onChange={(value) => { if (value) setTab(value); }}>
        <Tabs.List aria-label={t('agents.editorSections')}>
          <Tabs.Tab value="definition">{t('agents.definition')}</Tabs.Tab>
          <Tabs.Tab value="tools">{t('agents.tools')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="definition" className="agent-definition">
          <div className="agent-writing-fields">
            <TextInput name="name" label={t('agents.name')} placeholder={t('agents.nameExample')} required value={draft.name} disabled={busy} dir="auto"
              className="agent-name-field" ref={(input) => { fields.current.name = input; }} maxLength={subagentNameLimit * 2}
              error={issue?.field === 'name' && issue.message} onChange={(event) => change({ name: event.currentTarget.value })} />
            <PromptTextarea scope="agent" name="description" label={t('agents.capabilities')} placeholder={t('agents.capabilitiesExample')}
              required value={draft.description} disabled={busy} dir="auto"
              classNames={{ input: 'agent-writing-input', description: 'agent-text-count' }}
              ref={(input) => { fields.current.description = input; }} maxLength={agentDescriptionLimit} minRows={4} autosize
              inputWrapperOrder={['label', 'input', 'description', 'error']} description={textCount(draft.description, agentDescriptionLimit)}
              error={issue?.field === 'description' && issue.message} onChange={(event) => change({ description: event.currentTarget.value })} />
            <div>
              <PromptTemplateControls session={session} text={draft.instructions} disabled={busy} worldId={draft.worldId} worldTitle={draft.worldTitle}
                agentName={draft.name} onWorld={(world, code) => {
                  const next = code ? insertPromptCode(instructionInput.current, draft.instructions, code, agentInstructionsLimit) : draft.instructions;
                  if (next === undefined) return false;
                  change({ instructions: next, worldId: world?.id ?? null, worldTitle: world?.title });
                  return true;
                }} />
              <PromptTextarea scope="agent" name="instructions" label={t('agents.instructions')} placeholder={t('agents.instructionsExample')}
                required value={draft.instructions} disabled={busy} dir="auto"
                classNames={{ input: 'agent-writing-input', description: 'agent-text-count' }}
                ref={(input) => { fields.current.instructions = input; instructionInput.current = input; }}
                maxLength={agentInstructionsLimit} minRows={12} autosize
                inputWrapperOrder={['label', 'input', 'description', 'error']} description={textCount(draft.instructions, agentInstructionsLimit)}
                error={issue?.field === 'instructions' && issue.message} onChange={(event) => change({ instructions: event.currentTarget.value })} />
            </div>
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="tools" className="agent-tools-panel">
          <AgentTools selected={draft.tools} disabled={busy} issue={issue?.field === 'tools' ? issue.message : undefined}
            searchRef={(input) => { fields.current.tools = input; }} onChange={(tools) => change({ tools })} />
        </Tabs.Panel>
      </Tabs>
      {agent && <footer className="agent-editor-footer">
        <Button type="button" variant="subtle" color="red" disabled={busy} onClick={() => {
          setDeleteError(undefined);
          setConfirmDelete(true);
        }}>
          {t('agents.deleteAction')}
        </Button>
      </footer>}
    </div>
    {agent && <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('agents.deleteTitle')}
      classNames={{ body: 'agent-delete-dialog' }} closeButtonProps={{ 'aria-label': t('common.close') }}
      closeOnEscape={!removing} closeOnClickOutside={!removing} withCloseButton={!removing}>
      <p>{t('agents.deleteBody', { name: agent.name })}</p>
      {deleteError && <p className="agents-error" role="alert">{t(`error.${deleteError}`)}</p>}
      <div className="agent-confirm-actions">
        <Button type="button" variant="default" disabled={removing} data-autofocus onClick={() => setConfirmDelete(false)}>
          {t('common.cancel')}
        </Button>
        <Button type="button" color="red" loading={removing} onClick={() => void removeAgent()}>{t('common.delete')}</Button>
      </div>
    </Modal>}
  </form>;
}
