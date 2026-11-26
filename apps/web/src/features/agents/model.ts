import type { MessageKey } from '../../shared/i18n/i18n';
import { readAgent, type AgentDraft, type AgentField, type DeleteAgent, type SavedAgent } from '@kuroko/contracts/agents';
import { createEffect, createEvent, createStore, sample } from 'effector';
import { inActiveSession, $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';
import { ApiError, errorCode, type ErrorCode } from '../../shared/http/api';

type Library = { status: 'idle' | 'loading' | 'ready' | 'error'; agents: SavedAgent[]; error?: ErrorCode };
const path = '/agents';
const initial: Library = { status: 'idle', agents: [] };
export const agentsOpened = createEvent();

const loadFx = createEffect((session: ActiveSession) => sessionRequest<SavedAgent[]>(session, path));
const agentPath = (id: string) => `${path}/${encodeURIComponent(id)}`;
const saveFx = createEffect(({ session, agent, draft }: { session: ActiveSession; agent?: SavedAgent; draft: AgentDraft }) =>
  agent ? sessionRequest<SavedAgent>(session, agentPath(agent.id), { method: 'PUT', body: { ...draft, revision: agent.revision } })
    : sessionRequest<SavedAgent>(session, path, { method: 'POST', body: draft }));
const compareFx = createEffect(({ session, id }: { session: ActiveSession; id: string }) =>
  sessionRequest<SavedAgent>(session, agentPath(id)));
const removeFx = createEffect(({ session, id, revision }: { session: ActiveSession; id: string } & DeleteAgent) =>
  sessionRequest<void>(session, agentPath(id), { method: 'DELETE', body: { revision } }));
const loaded = inActiveSession(loadFx.done, (session) => session);
const failed = inActiveSession(loadFx.fail, (session) => session);
const saved = inActiveSession(saveFx.done, ({ session }) => session);
const removed = inActiveSession(removeFx.done, ({ session }) => session);
const compared = inActiveSession(compareFx.done, ({ session }) => session);
const saveFailed = inActiveSession(saveFx.fail, ({ session }) => session);
const removeFailed = inActiveSession(removeFx.fail, ({ session }) => session);
const compareFailed = inActiveSession(compareFx.fail, ({ session }) => session);

export const $agentLibrary = createStore(initial)
  .on(loadFx, (current) => ({ ...current, status: 'loading', error: undefined }))
  .on(loaded, (_, { result }) => ({ status: 'ready', agents: result }))
  .on(failed, (current, { error }) => ({ ...current, status: 'error', error: errorCode(error) }))
  .on([saved, compared], (current, { result }) => ({ ...current, agents: [...current.agents.filter(({ id }) => id !== result.id), result] }))
  .reset(sessionEnded);

sample({
  clock: agentsOpened,
  source: { session: $activeSession, library: $agentLibrary },
  filter: ({ session, library }) => session !== null && (library.status !== 'loading'),
  fn: ({ session }) => session!,
  target: loadFx,
});
sample({
  clock: [
    failed.map(({ params: session, error }) => ({ session, error })),
    saveFailed.map(({ params: { session }, error }) => ({ session, error })),
    removeFailed.map(({ params: { session }, error }) => ({ session, error })),
    compareFailed.map(({ params: { session }, error }) => ({ session, error })),
  ],
  target: protectedRequestFailed,
});

export type AgentEditorDraft = AgentDraft & Pick<SavedAgent, 'worldTitle'>;
type AgentIssue = { field?: AgentField; key: MessageKey; line?: string };
type AgentEditorState = {
  agent?: SavedAgent;
  draft: AgentEditorDraft;
  status: 'idle' | 'saving' | 'deleting' | 'comparing';
  saved: boolean;
  issue?: AgentIssue;
  deleteError?: ErrorCode;
  conflict?: { latest?: SavedAgent; error?: ErrorCode };
};

const emptyDraft: AgentDraft = { name: '', description: '', instructions: '', tools: [] };
export const agentComparisonFields = ['name', 'description', 'instructions', 'worldId', 'tools'] as const;
type ComparisonField = typeof agentComparisonFields[number];

export function agentFieldChanged(before: AgentDraft, after: AgentDraft, field: ComparisonField) {
  if (field === 'tools') return before.tools.length !== after.tools.length || before.tools.some((id) => !after.tools.includes(id));
  if (field === 'worldId') return (before.worldId ?? null) !== (after.worldId ?? null);
  return before[field] !== after[field];
}

function agentDirty({ agent, draft }: AgentEditorState) {
  return agentComparisonFields.some((field) => agentFieldChanged(agent ?? emptyDraft, draft, field));
}

function validationIssue(error: unknown): AgentIssue {
  const code = errorCode(error);
  const field = error instanceof ApiError ? error.field : undefined;
  if (code === 'agent_invalid' && (field === 'name' || field === 'description' || field === 'instructions' || field === 'tools')) {
    return { field, key: `agents.invalid.${field}` };
  }
  if (code === 'prompt_template_invalid') {
    return { field: 'instructions', key: field ? 'templates.lineError' : 'error.prompt_template_invalid', line: field };
  }
  return { key: `error.${code}` };
}

export const agentEditorOpened = createEvent<SavedAgent | undefined>();
export const agentEditorClosed = createEvent();
export const agentDraftChanged = createEvent<Partial<AgentEditorDraft>>();
export const agentSaveRequested = createEvent();
export const agentDeleteRequested = createEvent();
export const agentDeleteErrorCleared = createEvent();
export const agentComparisonRequested = createEvent();
export const agentComparisonResolved = createEvent<'keepEdits' | 'useLatest'>();
export const agentIssueCleared = createEvent();

const agentRemoved = [
  removed.map(({ params }) => params),
  removeFailed.filterMap(({ params, error }) => errorCode(error) === 'agent_not_found' ? params : undefined),
];
$agentLibrary.on(agentRemoved, (current, { id }) => ({ ...current, agents: current.agents.filter((agent) => agent.id !== id) }));

export const $agentEditor = createStore<AgentEditorState | null>(null)
  .on(agentDraftChanged, (editor, patch) => {
    if (!editor || editor.status !== 'idle') return editor;
    const field = editor.issue?.field;
    const editedField = field && (Object.hasOwn(patch, field) || (field === 'instructions' && Object.hasOwn(patch, 'worldId')));
    return { ...editor, draft: { ...editor.draft, ...patch }, saved: false, issue: editedField ? undefined : editor.issue };
  })
  .on(agentIssueCleared, (editor) => editor && { ...editor, issue: undefined })
  .on(agentDeleteErrorCleared, (editor) => editor && { ...editor, deleteError: undefined })
  .on(saveFx, (editor) => editor && { ...editor, status: 'saving', issue: undefined })
  .on(saved, (_, { result }) => ({ agent: result, draft: result, status: 'idle', saved: true }))
  .on(saveFailed, (editor, { error }) => editor && {
    ...editor, status: 'idle',
    ...(errorCode(error) === 'agent_conflict' ? { conflict: {} } : { issue: validationIssue(error) }),
  })
  .on(removeFx, (editor) => editor && { ...editor, status: 'deleting', deleteError: undefined })
  .on(removeFailed, (editor, { error }) => editor && {
    ...editor, status: 'idle',
    ...(errorCode(error) === 'agent_conflict' ? { conflict: {} } : { deleteError: errorCode(error) }),
  })
  .on(compareFx, (editor) => editor && { ...editor, status: 'comparing', conflict: {} })
  .on(compared, (editor, { result }) => editor && { ...editor, status: 'idle', conflict: { latest: result } })
  .on(compareFailed, (editor, { error }) => editor && { ...editor, status: 'idle', conflict: { error: errorCode(error) } })
  .on(agentComparisonResolved, (editor, action) => {
    const latest = editor?.conflict?.latest;
    if (!editor || !latest || !editor.agent || editor.status !== 'idle') return editor;
    const { agent, draft } = editor;
    const worldChanged = agentFieldChanged(agent, draft, 'worldId');
    return {
      agent: latest, status: 'idle', saved: false,
      draft: action === 'useLatest' ? latest : {
        name: agentFieldChanged(agent, draft, 'name') ? draft.name : latest.name,
        description: agentFieldChanged(agent, draft, 'description') ? draft.description : latest.description,
        instructions: agentFieldChanged(agent, draft, 'instructions') ? draft.instructions : latest.instructions,
        tools: agentFieldChanged(agent, draft, 'tools') ? draft.tools : latest.tools,
        worldId: worldChanged ? draft.worldId : latest.worldId,
        worldTitle: worldChanged ? draft.worldTitle : latest.worldTitle,
      },
    };
  })
  .reset(sessionEnded, ...agentRemoved);

const editorOpened = sample({
  clock: agentEditorOpened,
  source: { session: $activeSession, editor: $agentEditor },
  filter: ({ session, editor }) => session !== null && editor === null,
  fn: (_, agent) => ({ agent }),
});
const editorClosed = sample({ clock: agentEditorClosed, filter: $agentEditor.map((editor) => editor?.status === 'idle') });
$agentEditor.on(editorOpened, (_, { agent }) => ({ agent, draft: agent ?? emptyDraft, status: 'idle', saved: false }))
  .reset(editorClosed);

export const $agentRemoved = createStore(false).on(agentRemoved, () => true).reset(editorOpened, sessionEnded);

export const $agentEditing = $agentEditor.map(Boolean);
export const $agentEditorDirty = $agentEditor.map((editor) => editor !== null && agentDirty(editor));

const savePrepared = sample({
  clock: agentSaveRequested,
  source: { session: $activeSession, editor: $agentEditor },
  filter: ({ session, editor }) => session !== null && editor?.status === 'idle' && !editor.conflict,
  fn: ({ session, editor }) => ({
    session: session!, agent: editor!.agent, dirty: agentDirty(editor!), validation: readAgent(editor!.draft),
  }),
});
$agentEditor.on(savePrepared, (editor, { validation, dirty }) => {
  if (!editor) return editor;
  if ('field' in validation) return { ...editor, issue: { field: validation.field, key: `agents.invalid.${validation.field}` } };
  return editor.agent && !dirty ? { ...editor, issue: undefined, saved: true } : editor;
});
const agentWrite = savePrepared.filterMap(({ session, agent, dirty, validation }) =>
  'draft' in validation && (!agent || dirty) ? { session, agent, draft: validation.draft } : undefined);
sample({
  clock: agentWrite,
  target: saveFx,
});
sample({
  clock: agentDeleteRequested,
  source: { session: $activeSession, editor: $agentEditor },
  filter: ({ session, editor }) => session !== null && editor?.status === 'idle' && !editor.conflict && Boolean(editor.agent),
  fn: ({ session, editor }) => ({ session: session!, id: editor!.agent!.id, revision: editor!.agent!.revision }),
  target: removeFx,
});
sample({
  clock: agentComparisonRequested,
  source: { session: $activeSession, editor: $agentEditor },
  filter: ({ session, editor }) => session !== null && editor?.status === 'idle' && Boolean(editor.conflict && editor.agent),
  fn: ({ session, editor }) => ({ session: session!, id: editor!.agent!.id }),
  target: compareFx,
});
