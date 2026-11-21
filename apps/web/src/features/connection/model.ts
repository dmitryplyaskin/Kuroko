import { combine, createEffect, createEvent, createStore, sample, type StoreValue } from 'effector';
import {
  isApiKey, providers, readConnectionName, type ConnectionState, type Provider, type ProviderKey, type SaveConnectionPreset,
} from '@kuroko/contracts/connectionSettings';
import { abortFx } from '../../shared/async/abort';
import { errorMessage } from '../../shared/http/api';
import { $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../auth/sessionModel';
import { connectionApi } from './connectionApi';
import { createDraft, validateDraft, type ConnectionDraft } from './connectionDraft';
import { $modelCatalog, catalogInvalidated, catalogRequested } from './modelCatalog';

type Page = { session: ActiveSession; controller: AbortController };
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ConnectionState };
type PresetSubmission = { status: 'idle' } | { status: 'saved' | 'deleted'; message: string }
  | { status: 'error'; message: string; field?: 'name' };
type KeySubmission = { status: 'idle' | 'added' | 'removed' } | { status: 'error'; message: string };
type Action = { kind: 'savePreset' } | { kind: 'deletePreset' } | { kind: 'deleteKey'; id: string }
  | { kind: 'addKey'; name: FormDataEntryValue | null; apiKey: FormDataEntryValue | null };
type Mutation = { kind: 'savePreset'; id: string; preset: SaveConnectionPreset }
  | { kind: 'deletePreset'; id: string }
  | { kind: 'addKey'; provider: Provider; presetId: string; name: string; apiKey: string }
  | { kind: 'deleteKey'; provider: Provider; id: string };

export const connectionOpened = createEvent();
export const connectionClosed = createEvent();
export const connectionRetryRequested = createEvent();
export const presetSelected = createEvent<string>();
export const presetCopyRequested = createEvent();
export const connectionDraftChanged = createEvent<Partial<ConnectionDraft>>();
export const connectionProviderChanged = createEvent<Provider>();
export const connectionActionRequested = createEvent<Action>();
export const connectionModelsRequested = createEvent();
export const presetDeleteOpened = createEvent();
export const presetDeleteClosed = createEvent();
export const keyManagerOpened = createEvent();
export const keyManagerClosed = createEvent();
export const keyDeleteOpened = createEvent<ProviderKey>();
export const keyDeleteClosed = createEvent();
export const keyErrorCleared = createEvent();

const $page = createStore<Page | null>(null);
const pageActivated = sample({
  clock: connectionOpened,
  source: { session: $activeSession, page: $page },
  filter: ({ session, page }) => session !== null && page === null,
  fn: ({ session }): Page => ({ session: session!, controller: new AbortController() }),
});
$page.on(pageActivated, (_, page) => page);
const pageDeactivated = sample({
  clock: [connectionClosed, sessionEnded],
  source: $page,
  filter: (page): page is Page => page !== null,
});
$page.reset(pageDeactivated);
sample({ clock: pageDeactivated, fn: (page) => page.controller, target: abortFx });

export const loadConnectionFx = createEffect(({ session, controller }: Page) =>
  connectionApi.load(session.user.id, controller.signal));

export const mutateConnectionFx = createEffect(async ({ page, mutation }: { page: Page; mutation: Mutation }) => {
  const { session } = page;
  const id = session.user.id;
  const signal = session.controller.signal;
  switch (mutation.kind) {
    case 'savePreset':
      return { kind: mutation.kind, id: mutation.id, state: await connectionApi.savePreset(id, mutation.id, mutation.preset, signal) };
    case 'deletePreset':
      return { kind: mutation.kind, id: mutation.id, state: await connectionApi.deletePreset(id, mutation.id, signal) };
    case 'addKey':
      return {
        kind: mutation.kind, presetId: mutation.presetId,
        key: await connectionApi.addKey(id, mutation.provider, mutation.name, mutation.apiKey, signal),
      };
    case 'deleteKey':
      return { kind: mutation.kind, state: await connectionApi.deleteKey(id, mutation.provider, mutation.id, signal) };
  }
});

type PendingMutation = { page: Page; kind: Mutation['kind'] };
const $mutation = createStore<PendingMutation | null>(null)
  .on(mutateConnectionFx, (_, { page, mutation }) => ({ page, kind: mutation.kind }))
  .on(mutateConnectionFx.finally, (current, { params }) => current?.page === params.page ? null : current)
  .reset(sessionEnded);
export const $presetPending = $mutation.map((mutation) => mutation?.kind === 'savePreset' || mutation?.kind === 'deletePreset');
export const $keyPending = $mutation.map((mutation) => mutation?.kind === 'addKey' || mutation?.kind === 'deleteKey');

const loadDone = sample({
  clock: loadConnectionFx.done,
  source: $page,
  filter: (page, { params }) => page === params,
  fn: (_, { result }) => result,
});
const loadFailed = sample({
  clock: loadConnectionFx.fail,
  source: $page,
  filter: (page, { params }) => page === params,
  fn: (_, { params, error }) => ({ session: params.session, error }),
});
const mutationDone = sample({
  clock: mutateConnectionFx.done,
  source: $page,
  filter: (page, { params }) => page === params.page,
  fn: (_, { result }) => result,
});
const mutationFailed = sample({
  clock: mutateConnectionFx.fail,
  source: $page,
  filter: (page, { params }) => page === params.page,
  fn: (_, { params, error }) => ({ kind: params.mutation.kind, message: errorMessage(error) }),
});

export const $connectionLoad = createStore<LoadState>({ status: 'loading' })
  .on(loadConnectionFx, () => ({ status: 'loading' }))
  .on(loadDone, (_, data) => ({ status: 'ready', data }))
  .on(loadFailed, (_, { error }) => ({ status: 'error', message: errorMessage(error) }))
  .on(mutationDone, (load, result) => {
    if (result.kind !== 'addKey') return { status: 'ready', data: result.state };
    if (load.status === 'ready') return { status: 'ready', data: { ...load.data, keys: [...load.data.keys, result.key] } };
    return load;
  })
  .reset(pageDeactivated);

sample({
  clock: pageActivated,
  filter: $mutation.map((mutation) => mutation === null),
  target: loadConnectionFx,
});
sample({
  clock: connectionRetryRequested,
  source: { page: $page, load: $connectionLoad },
  filter: ({ page, load }) => page !== null && load.status === 'error',
  fn: ({ page }) => page!,
  target: loadConnectionFx,
});

// A write can finish after leaving the tab. On re-entry, load only after it settles.
sample({
  clock: mutateConnectionFx.finally,
  source: $page,
  filter: (page, { params }) => page !== null && page !== params.page && page.session === params.page.session,
  fn: (page) => page!,
  target: loadConnectionFx,
});
sample({ clock: loadFailed, target: protectedRequestFailed });
sample({
  clock: mutateConnectionFx.fail,
  fn: ({ params, error }) => ({ session: params.page.session, error }),
  target: protectedRequestFailed,
});

const $selectedId = createStore<string | null>(null)
  .on(presetSelected, (_, id) => id)
  .on(mutationDone, (id, result) => result.kind === 'savePreset' || result.kind === 'deletePreset'
    ? result.state.activePresetId ?? '' : id)
  .reset(pageDeactivated);

const $data = $connectionLoad.map((load) => load.status === 'ready' ? load.data : null);
const $presetId = combine($selectedId, $data, (selected, data) => selected ?? data?.activePresetId ?? '');
const $selectedPreset = combine($data, $presetId, (data, id) => data?.presets.find((preset) => preset.id === id) ?? null);
const $activePreset = $data.map((data) => data?.presets.find((preset) => preset.id === data.activePresetId) ?? null);
const $drafts = createStore<Record<string, ConnectionDraft>>({}).reset(pageDeactivated);
const $draft = combine($drafts, $selectedPreset, $presetId, (drafts, preset, id) => drafts[id] ?? createDraft(preset ?? undefined));
const $providerKeys = combine($data, $draft, (data, draft) => data?.keys.filter(({ provider }) => provider === draft.provider) ?? []);
const $keyId = combine($draft, $providerKeys, (draft, keys) => keys.some(({ id }) => id === draft.keyId) ? draft.keyId : '');

export const $connectionSelection = combine({
  presetId: $presetId, selectedPreset: $selectedPreset, activePreset: $activePreset, draft: $draft,
  providerKeys: $providerKeys, keyId: $keyId,
});

const presetCopied = sample({
  clock: presetCopyRequested,
  source: $connectionSelection,
  fn: ({ draft, keyId }) => ({ id: '', draft: { ...draft, name: '', keyId } }),
});

$selectedId.on(presetCopied, () => '');

const providerChanged = sample({
  clock: connectionProviderChanged,
  source: $draft,
  filter: (draft, provider) => provider !== draft.provider,
  fn: (draft, provider): Partial<ConnectionDraft> => ({
    provider, model: '', keyId: '', topK: providers[provider].topK ? draft.topK : '',
  }),
});

const draftChanged = sample({
  clock: [connectionDraftChanged, providerChanged],
  source: $connectionSelection,
  fn: ({ presetId, draft }, change) => ({ id: presetId, draft: { ...draft, ...change }, resetCatalog: 'keyId' in change || 'provider' in change }),
});

const keyAppliedToDraft = sample({
  clock: mutationDone,
  source: $connectionSelection,
  filter: ({ presetId, draft }, result) => result.kind === 'addKey' && result.presetId === presetId && result.key.provider === draft.provider,
  fn: ({ presetId, draft }, result) => ({
    id: presetId, draft: { ...draft, keyId: result.kind === 'addKey' ? result.key.id : draft.keyId },
  }),
});

$drafts
  .on([presetCopied, draftChanged, keyAppliedToDraft], (drafts, { id, draft }) => ({ ...drafts, [id]: draft }))
  .on(mutationDone, (drafts, result) => {
    if (result.kind !== 'savePreset' && result.kind !== 'deletePreset') return drafts;
    const next = { ...drafts };
    delete next[result.id];
    return next;
  });

sample({ clock: [presetSelected, presetCopied, pageDeactivated], target: catalogInvalidated });
sample({ clock: draftChanged, filter: ({ resetCatalog }) => resetCatalog, target: catalogInvalidated });
sample({
  clock: mutationDone,
  filter: (result) => result.kind !== 'savePreset',
  target: catalogInvalidated,
});

const $actionContext = combine({ selection: $connectionSelection, page: $page, pending: $mutation, load: $connectionLoad, catalog: $modelCatalog });

sample({
  clock: connectionModelsRequested,
  source: $actionContext,
  filter: ({ page, pending, load }) => page !== null && !pending && load.status === 'ready',
  fn: ({ page, selection }) => ({ session: page!.session, provider: selection.draft.provider, keyId: selection.keyId }),
  target: catalogRequested,
});

type PreparedAction = { mutation: Mutation } | { kind: 'savePreset' | 'addKey'; message: string; field?: 'name' };
function prepareAction({ draft, presetId, keyId }: StoreValue<typeof $connectionSelection>, action: Action): PreparedAction {
  switch (action.kind) {
    case 'savePreset': {
      const result = validateDraft(draft, keyId);
      return 'error' in result
        ? { kind: action.kind, message: result.error, field: result.field }
        : { mutation: { kind: action.kind, id: presetId, preset: result.preset } };
    }
    case 'deletePreset':
      return { mutation: { kind: action.kind, id: presetId } };
    case 'addKey': {
      const name = readConnectionName(action.name);
      const apiKey = typeof action.apiKey === 'string' ? action.apiKey.trim() : '';
      if (!name || !isApiKey(apiKey) || name.includes(apiKey)) {
        return { kind: action.kind, message: 'Укажите название ключа и введите API-ключ в отдельное поле.' };
      }
      return { mutation: { kind: action.kind, provider: draft.provider, presetId, name, apiKey } };
    }
    case 'deleteKey':
      return { mutation: { kind: action.kind, provider: draft.provider, id: action.id } };
  }
}

const actionPrepared = sample({
  clock: connectionActionRequested,
  source: $actionContext,
  filter: ({ page, pending, load, selection, catalog }, action) => {
    if (!page || pending || load.status !== 'ready') return false;
    if (action.kind === 'savePreset') return catalog.status !== 'loading';
    if (action.kind === 'deletePreset') return Boolean(selection.selectedPreset);
    if (action.kind === 'deleteKey') return selection.providerKeys.some(({ id }) => id === action.id);
    return true;
  },
  fn: ({ page, selection }, action) => ({ page: page!, result: prepareAction(selection, action) }),
});
const invalidAction = actionPrepared.filterMap(({ result }) => 'mutation' in result ? undefined : result);
const preparedMutation = actionPrepared.filterMap(({ page, result }) => 'mutation' in result ? { page, mutation: result.mutation } : undefined);
sample({ clock: preparedMutation, target: mutateConnectionFx });

export const $presetSubmission = createStore<PresetSubmission>({ status: 'idle' })
  .on(invalidAction, (current, error) => error.kind === 'savePreset'
    ? { status: 'error', message: error.message, field: error.field } : current)
  .on(mutationDone, (current, result) => {
    if (result.kind === 'savePreset') return { status: 'saved', message: 'Пресет сохранён.' };
    if (result.kind === 'deletePreset') return { status: 'deleted', message: 'Пресет удалён.' };
    return result.kind === 'addKey' ? { status: 'idle' } : current;
  })
  .on(mutationFailed, (current, { kind, message }) => kind === 'savePreset' ? { status: 'error', message } : current)
  .on(mutateConnectionFx, (current, { mutation }) => mutation.kind === 'savePreset' || mutation.kind === 'deletePreset'
    ? { status: 'idle' } : current)
  .reset(presetSelected, presetCopied, draftChanged, pageDeactivated);
export const $presetDeleteError = createStore('')
  .on(mutationFailed, (current, { kind, message }) => kind === 'deletePreset' ? message : current)
  .on(mutateConnectionFx, (current, { mutation }) => mutation.kind === 'deletePreset' ? '' : current)
  .reset(presetDeleteOpened, pageDeactivated);

export const $keySubmission = createStore<KeySubmission>({ status: 'idle' })
  .on(invalidAction, (current, error) => error.kind === 'addKey' ? { status: 'error', message: error.message } : current)
  .on(mutationDone, (current, result) => {
    if (result.kind === 'addKey') return { status: 'added' };
    if (result.kind === 'deleteKey') return { status: 'removed' };
    return current;
  })
  .on(mutationFailed, (current, { kind, message }) => kind === 'addKey' || kind === 'deleteKey'
    ? { status: 'error', message } : current)
  .on(mutateConnectionFx, (current, { mutation }) => mutation.kind === 'addKey' || mutation.kind === 'deleteKey'
    ? { status: 'idle' } : current)
  .on(keyErrorCleared, (current) => current.status === 'error' ? { status: 'idle' } : current)
  .reset(keyManagerOpened, keyDeleteOpened, pageDeactivated);

export const $presetDeleteOpen = createStore(false)
  .on(presetDeleteOpened, () => true)
  .on(mutationDone, (open, result) => result.kind === 'deletePreset' ? false : open)
  .reset(presetDeleteClosed, pageDeactivated);

export const $keyManagerOpen = createStore(false)
  .on(keyManagerOpened, () => true)
  .on(mutationDone, (open, result) => result.kind === 'addKey' ? false : open)
  .reset(keyManagerClosed, pageDeactivated);

export const $keyBeingDeleted = createStore<ProviderKey | null>(null)
  .on(keyDeleteOpened, (_, key) => key)
  .on(mutationDone, (key, result) => result.kind === 'deleteKey' ? null : key)
  .reset(keyManagerOpened, keyManagerClosed, keyDeleteClosed, pageDeactivated);
