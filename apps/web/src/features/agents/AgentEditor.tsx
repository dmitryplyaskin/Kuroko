import { Button, Modal, SimpleGrid, Stack, Tabs, Text, TextInput } from '@mantine/core';
import { agentDescriptionLimit, agentInstructionsLimit, type AgentField } from '@kuroko/contracts/agents';
import { subagentNameLimit } from '@kuroko/contracts/tools';
import { useUnit } from 'effector-react';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DiscardChangesDialog } from '../../shared/dialogs/DiscardChangesDialog';
import { useI18n, type MessageKey } from '../../shared/i18n/i18n';
import { PromptTextarea } from '../../shared/prompt-templates/TemplateHelp';
import { insertPromptCode, PromptTemplateControls } from '../instructions/PromptTemplateControls';
import { AgentToolPicker } from '../tools/AgentToolPicker';
import {
  $agentEditor, $agentEditorDirty, agentComparisonFields, agentComparisonRequested, agentComparisonResolved,
  agentDeleteErrorCleared, agentDeleteRequested, agentDraftChanged, agentEditorClosed, agentFieldChanged,
  agentIssueCleared, agentSaveRequested, type AgentEditorDraft,
} from './model';
import classes from './Agents.module.css';

export function AgentEditor() {
  const { t, number } = useI18n();
  const { editor, dirty, change, save, remove, close, clearIssue, clearDeleteError, compare, resolve } = useUnit({
    editor: $agentEditor, dirty: $agentEditorDirty, change: agentDraftChanged, save: agentSaveRequested,
    remove: agentDeleteRequested, close: agentEditorClosed, clearIssue: agentIssueCleared,
    clearDeleteError: agentDeleteErrorCleared, compare: agentComparisonRequested, resolve: agentComparisonResolved,
  });
  const [tab, setTab] = useState('definition');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const fields = useRef<Partial<Record<AgentField, HTMLElement | null>>>({});
  const instructionInput = useRef<HTMLTextAreaElement>(null);
  const issue = editor?.issue;

  useEffect(() => {
    if (!issue?.field) return;
    const field = issue.field;
    const frame = requestAnimationFrame(() => {
      setTab(field === 'tools' ? 'tools' : 'definition');
      fields.current[field]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [issue]);

  if (!editor) return null;
  const { agent, draft, status, saved, deleteError, conflict } = editor;
  const busy = status !== 'idle';
  const removing = status === 'deleting';
  const issueText = issue && t(issue.key, issue.line ? { line: issue.line } : undefined);
  const editorTab = issue?.field ? issue.field === 'tools' ? 'tools' : 'definition' : tab;

  function textCount(value: string, limit: number) {
    return t('agents.textCount', { count: number.format(value.length), limit: number.format(limit) });
  }

  return <form className={classes['agent-editor']} noValidate onSubmit={(event) => {
    event.preventDefault();
    if (!confirmLeave && !confirmDelete) save();
  }}>
    <div className={classes['agent-editor-bar']}>
      <header className={['page-heading', classes['agent-editor-heading']].join(' ')}>
        <Button className={classes['agent-back']} type="button" variant="subtle" disabled={busy}
          leftSection={<ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />}
          onClick={() => dirty ? setConfirmLeave(true) : close()}>{t('agents.back')}</Button>
        <h1 id="agents-title" tabIndex={-1}>{agent ? <bdi>{agent.name}</bdi> : t('agents.create')}</h1>
      </header>
      <div className={classes['agent-editor-actions']}>
        <output className={classes['agent-save-status']}>{saved && t('agents.saved')}</output>
        <Button type="submit" loading={status === 'saving'} disabled={confirmLeave || Boolean(conflict) || removing}>{t('common.save')}</Button>
      </div>
    </div>
    {issue && !issue.field && <p className={[classes['agents-error'], classes['agent-editor-error']].join(' ')} role="alert">{issueText}</p>}
    {conflict && !confirmLeave && <div className={classes['agents-load-error']}>
      <p className={classes['agents-error']} role="alert">{t('error.agent_conflict')}</p>
      <Button type="button" variant="default" onClick={() => {
        setComparisonOpen(true);
        if (!conflict.latest) compare();
      }}>{t('agents.compareVersions')}</Button>
    </div>}
    <Tabs className={classes['agent-editor-tabs']} value={editorTab} onChange={(value) => {
      if (!value) return;
      setTab(value);
      if (value !== editorTab) clearIssue();
    }}>
      <Tabs.List aria-label={t('agents.editorSections')}>
        <Tabs.Tab value="definition">{t('agents.definition')}</Tabs.Tab>
        <Tabs.Tab value="tools">{t('agents.tools')}</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="definition" className={classes['agent-definition']}>
        <div className={classes['agent-writing-fields']}>
          <TextInput name="name" label={t('agents.name')} placeholder={t('agents.nameExample')} required value={draft.name} disabled={busy} dir="auto"
            className={classes['agent-name-field']} ref={(input) => { fields.current.name = input; }} maxLength={subagentNameLimit * 2}
            error={issue?.field === 'name' && issueText} onChange={(event) => change({ name: event.currentTarget.value })} />
          <PromptTextarea scope="agent" name="description" label={t('agents.capabilities')} placeholder={t('agents.capabilitiesExample')}
            required value={draft.description} disabled={busy} dir="auto"
            classNames={{ input: classes['agent-writing-input'], description: classes['agent-text-count'] }}
            ref={(input) => { fields.current.description = input; }} maxLength={agentDescriptionLimit} minRows={4} autosize
            inputWrapperOrder={['label', 'input', 'description', 'error']} description={textCount(draft.description, agentDescriptionLimit)}
            error={issue?.field === 'description' && issueText} onChange={(event) => change({ description: event.currentTarget.value })} />
          <div>
            <PromptTemplateControls text={draft.instructions} disabled={busy} worldId={draft.worldId} worldTitle={draft.worldTitle}
              agentName={draft.name} onWorld={(world, code) => {
                const next = code ? insertPromptCode(instructionInput.current, draft.instructions, code, agentInstructionsLimit) : draft.instructions;
                if (next === undefined) return false;
                change({ instructions: next, worldId: world?.id ?? null, worldTitle: world?.title });
                return true;
              }} />
            <PromptTextarea scope="agent" name="instructions" label={t('agents.instructions')} placeholder={t('agents.instructionsExample')}
              required value={draft.instructions} disabled={busy} dir="auto"
              classNames={{ input: classes['agent-writing-input'], description: classes['agent-text-count'] }}
              ref={(input) => { fields.current.instructions = input; instructionInput.current = input; }}
              maxLength={agentInstructionsLimit} minRows={12} autosize
              inputWrapperOrder={['label', 'input', 'description', 'error']} description={textCount(draft.instructions, agentInstructionsLimit)}
              error={issue?.field === 'instructions' && issueText} onChange={(event) => change({ instructions: event.currentTarget.value })} />
          </div>
        </div>
      </Tabs.Panel>
      <Tabs.Panel value="tools" className={classes['agent-tools-panel']}>
        <AgentToolPicker selected={draft.tools} disabled={busy} issue={issue?.field === 'tools' ? issueText : undefined}
          searchRef={(input) => { fields.current.tools = input; }} onChange={(tools) => change({ tools })} />
      </Tabs.Panel>
    </Tabs>
    {agent && <footer className={classes['agent-editor-footer']}>
      <Button type="button" variant="subtle" color="red" disabled={busy} onClick={() => {
        clearDeleteError();
        setConfirmDelete(true);
      }}>
        {t('agents.deleteAction')}
      </Button>
    </footer>}
    <DiscardChangesDialog opened={confirmLeave} onClose={() => setConfirmLeave(false)} onDiscard={close} />
    {agent && <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('agents.deleteTitle')}
      classNames={{ body: classes['agent-delete-dialog'] }} closeButtonProps={{ 'aria-label': t('common.close') }}
      closeOnEscape={!removing} closeOnClickOutside={!removing} withCloseButton={!removing}>
      <p>{t('agents.deleteBody', { name: agent.name })}</p>
      {deleteError && <p className={classes['agents-error']} role="alert">{t(`error.${deleteError}`)}</p>}
      <div className={classes['agent-confirm-actions']}>
        <Button type="button" variant="default" disabled={removing} data-autofocus onClick={() => setConfirmDelete(false)}>
          {t('common.cancel')}
        </Button>
        <Button type="button" color="red" loading={removing} onClick={remove}>{t('common.delete')}</Button>
      </div>
    </Modal>}
    {conflict && <Modal opened={comparisonOpen} onClose={() => setComparisonOpen(false)} title={t('agents.compareVersions')}
      size="lg" closeButtonProps={{ 'aria-label': t('common.close') }}>
      {conflict.latest ? <>
        <p>{t('agents.compareHelp')}</p>
        <AgentComparison draft={draft} latest={conflict.latest} />
        <div className={classes['agent-confirm-actions']}>
          <Button type="button" variant="default" onClick={() => { resolve('useLatest'); setComparisonOpen(false); }}>{t('agents.useLatest')}</Button>
          <Button type="button" onClick={() => { resolve('keepEdits'); setComparisonOpen(false); }}>{t('agents.keepEdits')}</Button>
        </div>
      </> : conflict.error ? <>
        <p role="alert">{t(`error.${conflict.error}`)}</p>
        <Button type="button" variant="default" onClick={compare}>{t('common.retryLoad')}</Button>
      </> : <output>{t('common.loading')}</output>}
    </Modal>}
  </form>;
}

const comparisonLabels: Record<typeof agentComparisonFields[number], MessageKey> = {
  name: 'agents.name', description: 'agents.capabilities', instructions: 'agents.instructions',
  worldId: 'templates.chooseWorld', tools: 'agents.allowedTools',
};

function AgentComparison({ draft, latest }: { draft: AgentEditorDraft; latest: AgentEditorDraft }) {
  const { t } = useI18n();
  const fields = agentComparisonFields.filter((field) => agentFieldChanged(latest, draft, field));
  function value(agent: AgentEditorDraft, field: typeof agentComparisonFields[number]) {
    if (field === 'tools') return agent.tools.join(', ');
    if (field === 'worldId') return agent.worldTitle ?? agent.worldId;
    return agent[field];
  }

  return <Stack gap="sm">
    {fields.map((field) => <section key={field}>
      <Text component="h3" fw={600}>{t(comparisonLabels[field])}</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <div>
          <Text size="sm">{t('agents.yourDraft')}</Text>
          <Text dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value(draft, field) || '—'}</Text>
        </div>
        <div>
          <Text size="sm">{t('agents.latestVersion')}</Text>
          <Text dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value(latest, field) || '—'}</Text>
        </div>
      </SimpleGrid>
    </section>)}
  </Stack>;
}
