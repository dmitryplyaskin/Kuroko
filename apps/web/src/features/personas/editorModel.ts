import { readPersona, type CreatePersona, type DeletePersona, type PersonaDraft, type SavedPersona, type UpdatePersona } from '@kuroko/contracts/personas';
import { createEffect, createEvent, createStore, merge, sample } from 'effector';
import { $activeSession, inActiveSession, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';
import { toAvatar } from '../../shared/avatar/avatarFile';
import { newLocalId } from '../../shared/browser/id';
import { ApiError, errorCode, type ErrorCode } from '../../shared/http/api';
import { parseVariableDrafts, variableDrafts, variableDraftsEqual, type VariableDraft } from '../../shared/variables/variableDraft';
import { personaEffect, personaPath, personasPath } from './requests';

type Fields = Omit<PersonaDraft, 'variables'> & { variables: VariableDraft[] };
type Issue = { code: ErrorCode; field?: string };
type DetailsRequest = { session: ActiveSession; id: string };
export type ReadyPersonaEditor = {
  status: 'ready';
  id: string;
  saved?: SavedPersona;
  baseline: Fields;
  draft: Fields;
  operation?: 'saving' | 'deleting' | 'avatar';
  issue?: Issue;
  saveNotice?: boolean;
};
type Editor = ReadyPersonaEditor | { status: 'loading'; request: DetailsRequest } | { status: 'error'; id: string; code: ErrorCode };

const emptyFields: Fields = { name: '', description: '', variables: [] };
function readyEditor(id: string, saved?: SavedPersona, saveNotice = false): ReadyPersonaEditor {
  const draft = saved ? { name: saved.name, description: saved.description, avatar: saved.avatar, variables: variableDrafts(saved.variables) } : emptyFields;
  return { status: 'ready', id, saved, draft, baseline: draft, saveNotice };
}

function idle(editor: Editor | null): editor is ReadyPersonaEditor {
  return editor?.status === 'ready' && !editor.operation;
}

function issueFrom(error: unknown): Issue {
  return { code: errorCode(error), field: error instanceof ApiError ? error.field : undefined };
}

export const personaCreated = createEvent();
export const personaOpened = createEvent<string>();
export const personaClosed = createEvent();
export const personaEdited = createEvent<Partial<Fields>>();
export const personaSaveRequested = createEvent();
export const personaDeleteRequested = createEvent();
export const personaAvatarPicked = createEvent<File>();

const detailsFx = personaEffect(({ session, id }: DetailsRequest) => sessionRequest<SavedPersona>(session, personaPath(id)));
const saveFx = personaEffect(({ session, id, draft, revision }: DetailsRequest & { draft: PersonaDraft; revision?: number }) =>
  revision === undefined
    ? sessionRequest<SavedPersona>(session, personasPath, { method: 'POST', body: { ...draft, id } satisfies CreatePersona })
    : sessionRequest<SavedPersona>(session, personaPath(id), { method: 'PUT', body: { ...draft, revision } satisfies UpdatePersona }));
const deleteFx = personaEffect(({ session, id, revision }: DetailsRequest & DeletePersona) =>
  sessionRequest<void>(session, personaPath(id), { method: 'DELETE', body: { revision } satisfies DeletePersona }));
const avatarFx = createEffect(({ file }: DetailsRequest & { file: File }) => toAvatar(file));

const loaded = inActiveSession(detailsFx.done, ({ session }) => session);
const loadFailed = inActiveSession(detailsFx.fail, ({ session }) => session);
const saved = inActiveSession(saveFx.done, ({ session }) => session);
const saveFailed = inActiveSession(saveFx.fail, ({ session }) => session);
const deleted = inActiveSession(deleteFx.done, ({ session }) => session);
const deleteFailed = inActiveSession(deleteFx.fail, ({ session }) => session);
const alreadyDeleted = deleteFailed.filterMap((failure) => errorCode(failure.error) === 'persona_not_found' ? failure : undefined);
export const personaWritten = merge([saved, deleted, alreadyDeleted]);
const avatarReady = inActiveSession(avatarFx.done, ({ session }) => session);
const avatarFailed = inActiveSession(avatarFx.fail, ({ session }) => session);

export const $personaEditor = createStore<Editor | null>(null)
  .on(personaCreated, (editor) => editor ?? readyEditor(newLocalId()))
  .on(personaClosed, (editor) => editor?.status === 'ready' && editor.operation ? editor : null)
  .on(detailsFx, (_, request) => ({ status: 'loading', request }))
  .on(loaded, (editor, { params, result }) =>
    editor?.status === 'loading' && editor.request === params ? readyEditor(result.id, result) : editor)
  .on(loadFailed, (editor, { params, error }) =>
    editor?.status === 'loading' && editor.request === params ? { status: 'error', id: params.id, code: errorCode(error) } : editor)
  .on(personaEdited, (editor, change) => idle(editor) ? {
    ...editor, draft: { ...editor.draft, ...change }, saveNotice: false,
    issue: editor.issue?.code === 'persona_conflict' ? editor.issue : undefined,
  } : editor)
  .on(saveFx, (editor) => editor?.status === 'ready' ? { ...editor, operation: 'saving', issue: undefined, saveNotice: false } : editor)
  .on(saved, (_, { result }) => readyEditor(result.id, result, true))
  .on([saveFailed, deleteFailed], (editor, { error }) => editor?.status === 'ready' ? {
    ...editor, operation: undefined, issue: issueFrom(error),
  } : editor)
  .on(deleteFx, (editor) => editor?.status === 'ready' ? { ...editor, operation: 'deleting', issue: undefined, saveNotice: false } : editor)
  .on(avatarFx, (editor) => editor?.status === 'ready' ? { ...editor, operation: 'avatar', saveNotice: false } : editor)
  .on(avatarReady, (editor, { params, result }) => editor?.status === 'ready' && editor.id === params.id ? {
    ...editor, operation: undefined, draft: { ...editor.draft, avatar: result },
    issue: editor.issue?.code === 'persona_conflict' ? editor.issue : undefined,
  } : editor)
  .on(avatarFailed, (editor, { params }) => editor?.status === 'ready' && editor.id === params.id ? {
    ...editor, operation: undefined, issue: editor.issue?.code === 'persona_conflict' ? editor.issue : { code: 'persona_invalid', field: '/avatar' },
  } : editor)
  .reset(sessionEnded, deleted, alreadyDeleted);

export const $personaDirty = $personaEditor.map((editor) => {
  if (editor?.status !== 'ready') return false;
  const { baseline, draft } = editor;
  return draft.name !== baseline.name || draft.description !== baseline.description || draft.avatar !== baseline.avatar ||
    !variableDraftsEqual(baseline.variables, draft.variables);
});

sample({
  clock: personaOpened,
  source: { session: $activeSession, editor: $personaEditor },
  filter: ({ session, editor }) => session !== null && (editor?.status !== 'ready' || !editor.operation),
  fn: ({ session }, id) => ({ session: session!, id }),
  target: detailsFx,
});

const validation = sample({
  clock: personaSaveRequested,
  source: { session: $activeSession, editor: $personaEditor },
  filter: ({ session, editor }) => session !== null && idle(editor) && editor.issue?.code !== 'persona_conflict',
  fn: ({ session, editor }) => {
    const { draft, id, saved } = editor as ReadyPersonaEditor;
    const parsed = parseVariableDrafts(draft.variables);
    const result = 'field' in parsed ? parsed : readPersona({ ...draft, variables: parsed.variables });
    return { session: session!, id, revision: saved?.revision, result };
  },
});
$personaEditor.on(validation, (editor, { result }) => idle(editor) && 'field' in result
  ? { ...editor, issue: { code: 'persona_invalid', field: result.field }, saveNotice: false } : editor);
sample({
  clock: validation.filterMap(({ result, ...params }) => 'draft' in result ? { ...params, draft: result.draft } : undefined),
  target: saveFx,
});
sample({
  clock: personaDeleteRequested,
  source: { session: $activeSession, editor: $personaEditor },
  filter: ({ session, editor }) => session !== null && idle(editor) && Boolean(editor.saved) && editor.issue?.code !== 'persona_conflict',
  fn: ({ session, editor }) => ({ session: session!, id: (editor as ReadyPersonaEditor).id, revision: (editor as ReadyPersonaEditor).saved!.revision }),
  target: deleteFx,
});
sample({
  clock: personaAvatarPicked,
  source: { session: $activeSession, editor: $personaEditor },
  filter: ({ session, editor }) => session !== null && idle(editor) && editor.issue?.code !== 'persona_conflict',
  fn: ({ session, editor }, file) => ({ session: session!, id: (editor as ReadyPersonaEditor).id, file }),
  target: avatarFx,
});
