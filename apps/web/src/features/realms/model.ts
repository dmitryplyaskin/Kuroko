import {
  readRealm, realmDocumentsEqual, realmSpecVersion, type Realm, type RealmFavorite, type RealmFilterOptions,
  type RealmList, type RealmListQuery, type RealmVariable, type SavedRealm,
} from '@kuroko/contracts/realms';
import { attach, createEffect, createEvent, createStore, sample, type Effect } from 'effector';
import { $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { inActiveSession, sessionRequest } from '../../platform/session/request';
import { ApiError, errorCode, type ErrorCode } from '../../shared/http/api';

import { abortFx } from '../../shared/async/abort';
import { downloadRealmFile, type ImportedRealm } from './realmFile';

type Request = { session: ActiveSession; signal: AbortSignal };
type ListRequest = Request & { query: RealmListQuery };
type QueryState<Params, Data> = { params: Params } & (
  { status: 'loading'; data?: Data } | { status: 'ready'; data: Data } | { status: 'error'; code: ErrorCode }
);

export function newRealmId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function realmEffect<P extends { session: ActiveSession }, Data>(request: (params: P) => Promise<Data>) {
  const effect = createEffect(request);
  sample({
    clock: inActiveSession(effect.fail, ({ session }) => session),
    fn: ({ params, error }) => ({ session: params.session, error }),
    target: protectedRequestFailed,
  });
  return effect;
}

function trackQuery<P extends ListRequest, Data>(effect: Effect<P, Data, Error>) {
  return createStore<QueryState<P, Data> | null>(null)
    .on(effect, (current, params) => ({
      params, status: 'loading', data: current?.params.session === params.session && current.params.query === params.query &&
        current.status !== 'error' ? current.data : undefined,
    }))
    .on(inActiveSession(effect.done, ({ session }) => session), (current, { params, result }) => {
      if (current?.params === params && !params.signal.aborted) return { params, status: 'ready', data: result };
      return current;
    })
    .on(inActiveSession(effect.fail, ({ session }) => session), (current, { params, error }) => {
      if (current?.params === params && !params.signal.aborted) return { params, status: 'error', code: errorCode(error) };
      return current;
    })
    .reset(sessionEnded);
}

export function requestRealmList({ session, signal, query }: ListRequest) {
  const params = new URLSearchParams({ q: query.q, sort: query.sort, limit: String(query.limit), offset: String(query.offset) });
  const { author, tags, starts, favorites } = query.filters;
  if (author) params.set('author', author);
  for (const tag of tags) params.append('tag', tag);
  if (starts !== 'any') params.set('starts', starts);
  if (favorites) params.set('favorites', '1');
  return sessionRequest<RealmList>(session, `/realms?${params}`, { signal });
}

export const listRealmsFx = realmEffect(requestRealmList);

const realmPath = (id: string) => `/realms/${encodeURIComponent(id)}`;

export const loadRealmFiltersFx = realmEffect(({ session, signal }: Request) =>
  sessionRequest<RealmFilterOptions>(session, '/realms/filters', { signal }));

export const setRealmFavoriteFx = realmEffect(({ session, id, favorite }: RealmFavorite & { session: ActiveSession }) =>
  sessionRequest<RealmFavorite>(session, `${realmPath(id)}/favorite`, { method: 'PUT', body: { favorite } }));

type EditorLoad = { session: ActiveSession; controller: AbortController; id: string };
const loadRealmFx = realmEffect(({ session, controller, id }: EditorLoad) =>
  sessionRequest<SavedRealm>(session, realmPath(id), { signal: controller.signal }));

export const saveRealmFx = realmEffect(({ session, realm, saved }: { session: ActiveSession; realm: Realm; saved?: SavedRealm }) =>
  saved ? sessionRequest<SavedRealm>(session, realmPath(saved.id), { method: 'PUT', body: { revision: saved.revision, realm } })
    : sessionRequest<SavedRealm>(session, '/realms', { method: 'POST', body: realm }));

const deleteRealmFx = realmEffect(({ session, id, revision }: { session: ActiveSession; id: string; revision: number }) =>
  sessionRequest<void>(session, `${realmPath(id)}?revision=${revision}`, { method: 'DELETE' }));

const favoriteChanged = inActiveSession(setRealmFavoriteFx.done, ({ session }) => session);
export const $realmList = trackQuery(listRealmsFx).on(favoriteChanged, (current, { params, result }) => {
  if (!current || current.params.session !== params.session || current.status === 'error' || !current.data ||
      current.params.query.filters.favorites) return current;
  const { data } = current;
  return {
    ...current, data: { ...data, items: data.items.map((item) => item.id === result.id
      ? { ...item, favorite: result.favorite ? true : undefined } : item) },
  };
});

sample({
  clock: favoriteChanged,
  source: $realmList,
  filter: (current, { params }) => Boolean(current && current.params.session === params.session && !current.params.signal.aborted &&
    (current.params.query.filters.favorites || current.status !== 'ready')),
  fn: (current) => ({ ...current!.params }),
  target: listRealmsFx,
});

export type VariableDraft = { id: string; name: string; source: string; format: 'text' | 'json' };
export type RealmSaveIssue = { code: ErrorCode; field?: string };
export type RealmEditorState = {
  status: 'ready';
  saving: boolean;
  deleting: boolean;
  imported?: ImportedRealm;
  saved?: SavedRealm;
  baseline: Realm;
  draft: Realm;
  baselineVariables: VariableDraft[];
  variables: VariableDraft[];
  issue?: RealmSaveIssue;
  deleteError?: ErrorCode;
  saveNotice: boolean;
};
type RealmEditorView = RealmEditorState | { status: 'loading'; request: EditorLoad } | { status: 'error'; id: string; code: ErrorCode };

function variableDrafts(variables: RealmVariable[] = []): VariableDraft[] {
  return variables.map(({ name, value }) => typeof value === 'string'
    ? { id: newRealmId(), name, source: value, format: 'text' }
    : { id: newRealmId(), name, source: JSON.stringify(value), format: 'json' });
}

function prepareEditor(saved?: SavedRealm, imported?: ImportedRealm): RealmEditorState {
  const realm = saved?.realm ?? imported?.realm ?? { specVersion: realmSpecVersion, id: newRealmId(), title: '', base: '' };
  const variables = variableDrafts(realm.variables);
  return {
    status: 'ready', saving: false, deleting: false, imported, saved, baseline: realm, draft: realm,
    baselineVariables: variables, variables, saveNotice: false,
  };
}

function editorDirty(editor: RealmEditorState) {
  const { baseline, draft, baselineVariables, variables } = editor;
  return !realmDocumentsEqual(baseline, draft) || baselineVariables.length !== variables.length ||
    variables.some(({ name, source, format }, index) => {
      const initial = baselineVariables[index]!;
      return name !== initial.name || source !== initial.source || format !== initial.format;
    });
}

function canEdit(view: RealmEditorView | null): view is RealmEditorState {
  return view?.status === 'ready' && !view.saving && !view.deleting;
}

function validateEditor({ draft, variables }: RealmEditorState): { realm: Realm } | RealmSaveIssue {
  const parsedVariables: RealmVariable[] = [];
  for (const [index, { name, source, format }] of variables.entries()) {
    try {
      parsedVariables.push({ name: name.trim(), value: format === 'text' ? source : JSON.parse(source) });
    } catch {
      return { code: 'realm_variable_value_invalid', field: `/variables/${index}/value` };
    }
  }
  return readRealm({
    ...draft, title: draft.title.trim(), sections: draft.sections?.map((entry) => ({ ...entry, title: entry.title.trim() })),
    variables: parsedVariables.length ? parsedVariables : undefined,
  });
}

function pruneReferences(realm: Realm): Realm {
  const characterIds = new Set(realm.characters?.map(({ id }) => id));
  const loreIds = new Set(realm.lorebook?.map(({ id }) => id));
  const sectionIds = new Map(realm.sections?.map(({ id, entries }) => [id, new Set(entries.map((entry) => entry.id))]));
  return {
    ...realm,
    starts: realm.starts?.map((start) => ({
      ...start,
      characterIds: start.characterIds?.filter((id) => characterIds.has(id)),
      loreEntryIds: start.loreEntryIds?.filter((id) => loreIds.has(id)),
      sectionEntries: start.sectionEntries?.filter(({ sectionId, entryId }) => sectionIds.get(sectionId)?.has(entryId)),
    })),
  };
}

export const realmEditorCreated = createEvent<ImportedRealm | undefined>();
export const realmEditorOpened = createEvent<string>();
export const realmEditorClosed = createEvent();
export const realmLoadRetried = createEvent();
export const realmEditorDraftChanged = createEvent<{ patch: Partial<Realm>; removed?: boolean }>();
export const realmEditorVariablesChanged = createEvent<VariableDraft[]>();
export const realmEditorDraftDiscarded = createEvent();
export const realmEditorDeleteErrorCleared = createEvent();
export const realmEditorActionRequested = createEvent<'save' | 'export'>();
export const realmEditorDeleteRequested = createEvent();

const writeRealmFx = attach({ effect: saveRealmFx });
const exportRealmFx = createEffect(({ realm }: { session: ActiveSession; realm: Realm }) => downloadRealmFile(realm));
const savedRealm = inActiveSession(writeRealmFx.done, ({ session }) => session);
const realmSaveFailed = inActiveSession(writeRealmFx.fail, ({ session }) => session);
const realmExportFailed = inActiveSession(exportRealmFx.fail, ({ session }) => session);
const deletedRealm = inActiveSession(deleteRealmFx.done, ({ session }) => session);
const realmDeleteFailed = inActiveSession(deleteRealmFx.fail, ({ session }) => session);
const deletedElsewhere = realmDeleteFailed.filter({ fn: ({ error }) => errorCode(error) === 'realm_not_found' });

const loadDone = inActiveSession(loadRealmFx.done, ({ session }) => session);
const loadFailed = inActiveSession(loadRealmFx.fail, ({ session }) => session);

function saveIssue(error: unknown, fallback = errorCode(error)): RealmSaveIssue {
  return error instanceof ApiError ? { code: error.code, field: error.field } : { code: fallback };
}

export const $realmEditor = createStore<RealmEditorView | null>(null)
  .on(loadRealmFx, (_, request) => ({ status: 'loading', request }))
  .on(loadDone, (view, { params, result }) => view?.status === 'loading' && view.request === params ? prepareEditor(result) : view)
  .on(loadFailed, (view, { params, error }) => view?.status === 'loading' && view.request === params
    ? { status: 'error', code: errorCode(error), id: params.id } : view)
  .on(realmEditorDraftChanged, (view, { patch, removed }) => {
    if (!canEdit(view)) return view;
    const next = { ...view.draft, ...patch };
    return { ...view, draft: removed ? pruneReferences(next) : next, issue: undefined, saveNotice: false };
  })
  .on(realmEditorVariablesChanged, (view, variables) => canEdit(view) ? { ...view, variables, issue: undefined, saveNotice: false } : view)
  .on(realmEditorDraftDiscarded, (view) => canEdit(view) ? {
    ...view, draft: view.baseline, variables: view.baselineVariables, issue: undefined, saveNotice: false,
  } : view)
  .on(realmEditorDeleteErrorCleared, (view) => canEdit(view) ? { ...view, deleteError: undefined } : view)
  .on(writeRealmFx, (view) => canEdit(view) ? { ...view, saving: true } : view)
  .on(savedRealm, (view, { result }) => view?.status === 'ready' && view.saving ? {
    ...prepareEditor(result), saveNotice: true,
  } : view)
  .on(realmSaveFailed, (view, { error }) => view?.status === 'ready' && view.saving
    ? { ...view, saving: false, issue: saveIssue(error) } : view)
  .on(realmExportFailed, (view, { error }) => canEdit(view) ? { ...view, issue: saveIssue(error, 'realm_file_download_failed') } : view)
  .on(deleteRealmFx, (view) => canEdit(view) ? { ...view, deleting: true, deleteError: undefined } : view)
  .on(realmDeleteFailed, (view, { error }) => view?.status === 'ready' && view.deleting
    ? { ...view, deleting: false, deleteError: errorCode(error) } : view)
  .reset(sessionEnded, deletedRealm, deletedElsewhere);

export const $realmEditorDirty = $realmEditor.map((view) => view?.status === 'ready' && editorDirty(view));
export const $realmEditorHasUnsavedChanges = $realmEditor.map((view) =>
  view?.status === 'ready' && (Boolean(view.imported && !view.saved) || editorDirty(view)));

const editorCreated = sample({
  clock: realmEditorCreated,
  source: { session: $activeSession, view: $realmEditor },
  filter: ({ session, view }) => session !== null && view === null,
  fn: (_, imported) => ({ imported }),
});
$realmEditor.on(editorCreated, (_, { imported }) => prepareEditor(undefined, imported));
sample({
  clock: realmEditorOpened,
  source: { session: $activeSession, view: $realmEditor },
  filter: ({ session, view }) => session !== null && view === null,
  fn: ({ session }, id): EditorLoad => ({ session: session!, controller: new AbortController(), id }),
  target: loadRealmFx,
});
sample({
  clock: realmLoadRetried,
  source: { session: $activeSession, view: $realmEditor },
  filter: ({ session, view }) => session !== null && view?.status === 'error',
  fn: ({ session, view }): EditorLoad => ({
    session: session!, controller: new AbortController(), id: (view as { id: string }).id,
  }),
  target: loadRealmFx,
});
const editorClosed = sample({
  clock: realmEditorClosed,
  source: $realmEditor,
  filter: (view) => view !== null && (view.status !== 'ready' || canEdit(view)),
  fn: (view) => ({ controller: view?.status === 'loading' ? view.request.controller : undefined }),
});
$realmEditor.reset(editorClosed);
sample({ clock: editorClosed.filterMap(({ controller }) => controller), target: abortFx });

const editorAction = sample({
  clock: realmEditorActionRequested,
  source: { session: $activeSession, view: $realmEditor },
  filter: ({ session, view }) => session !== null && canEdit(view),
  fn: ({ session, view }, action) => {
    const editor = view as RealmEditorState;
    const unchanged = action === 'save' && Boolean(editor.saved) && !editorDirty(editor);
    return { session: session!, editor, action, result: unchanged ? null : validateEditor(editor) };
  },
});
$realmEditor.on(editorAction, (view, { result }) => {
  if (view?.status !== 'ready') return view;
  if (!result) return { ...view, issue: undefined, saveNotice: true };
  return { ...view, issue: 'realm' in result ? undefined : result };
});
const validAction = editorAction.filterMap(({ result, editor, ...action }) =>
  result && 'realm' in result ? { ...action, realm: result.realm, saved: editor.saved } : undefined);
sample({
  clock: validAction,
  filter: ({ action }) => action === 'save',
  fn: ({ session, realm, saved }) => ({ session, realm, saved }),
  target: writeRealmFx,
});
sample({
  clock: validAction,
  filter: ({ action }) => action === 'export',
  fn: ({ session, realm }) => ({ session, realm }),
  target: exportRealmFx,
});
sample({
  clock: realmEditorDeleteRequested,
  source: { session: $activeSession, view: $realmEditor },
  filter: ({ session, view }) => session !== null && canEdit(view) && Boolean(view.saved),
  fn: ({ session, view }) => {
    const { id, revision } = (view as RealmEditorState).saved!;
    return { session: session!, id, revision };
  },
  target: deleteRealmFx,
});
