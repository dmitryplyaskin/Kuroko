import { attach, combine, createEffect, createEvent, createStore, sample, type StoreValue } from 'effector';
import {
  isApiKey, providers, readConnectionName, type ConnectionState, type Provider, type ProviderKey, type SaveConnectionPreset,
} from '@kuroko/contracts/connectionSettings';
import { readPresetName, type PresetAction, type PresetManagementAction } from '@kuroko/contracts/presets';
import { abortFx } from '../../shared/async/abort';
import { ApiError, errorCode, type ErrorCode } from '../../shared/http/api';
import { $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { inActiveSession } from '../../platform/session/request';
import { connectionApi } from './connectionApi';
import { createDraft, validateDraft, type ConnectionDraft } from './connectionDraft';
import { $modelCatalog, $openRouterEndpoints, catalogInvalidated, catalogRequested, endpointsInvalidated, endpointsRequested } from './modelCatalog';

type Page = { session: ActiveSession; controller: AbortController };
type LoadState = { status: 'loading' } | { status: 'error'; code: ErrorCode } | { status: 'ready'; data: ConnectionState };
type KeySubmission = { status: 'idle' | 'added' | 'removed' } | { status: 'error'; code: ErrorCode };
type KeyAction = { kind: 'deleteKey'; id: string }
  | { kind: 'addKey'; name: FormDataEntryValue | null; apiKey: FormDataEntryValue | null };
type Mutation = { kind: 'savePreset'; id: string; preset: SaveConnectionPreset }
  | { kind: 'managePreset'; action: PresetManagementAction }
  | { kind: 'addKey'; provider: Provider; presetId: string; name: string; apiKey: string }
  | { kind: 'deleteKey'; provider: Provider; id: string };
type MutationRequest = { page: Page; mutation: Mutation; editorVersion: number };

export const connectionOpened = createEvent();
export const connectionClosed = createEvent();
export const connectionTabClosed = createEvent();
export const connectionRetryRequested = createEvent();
export const connectionDraftChanged = createEvent<Partial<ConnectionDraft>>();
export const connectionProviderChanged = createEvent<Provider>();
export const connectionActionRequested = createEvent<KeyAction>();
export const connectionModelsRequested = createEvent();
export const connectionEndpointsRequested = createEvent();
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
const editorReset = sample({ clock: [connectionTabClosed, pageDeactivated], fn: () => undefined });
const $editorVersion = createStore(0).on(editorReset, (version) => version + 1);

export const loadConnectionFx = createEffect(({ session, controller }: Page) =>
  connectionApi.load(session, controller.signal));

export const mutateConnectionFx = createEffect(async ({ page, mutation }: MutationRequest) => {
  const { session } = page;
  switch (mutation.kind) {
    case 'savePreset':
      return { kind: mutation.kind, id: mutation.id, state: await connectionApi.savePreset(session, mutation.id, mutation.preset) };
    case 'managePreset':
      return { kind: mutation.kind, action: mutation.action, state: await connectionApi.managePreset(session, mutation.action) };
    case 'addKey':
      return {
        kind: mutation.kind, presetId: mutation.presetId,
        key: await connectionApi.addKey(session, mutation.provider, mutation.name, mutation.apiKey),
      };
    case 'deleteKey':
      return { kind: mutation.kind, state: await connectionApi.deleteKey(session, mutation.provider, mutation.id) };
  }
});

type PendingMutation = { page: Page; kind: Mutation['kind'] };
const $mutation = createStore<PendingMutation | null>(null)
  .on(mutateConnectionFx, (_, { page, mutation }) => ({ page, kind: mutation.kind }))
  .on(mutateConnectionFx.finally, (current, { params }) => current?.page === params.page ? null : current)
  .reset(sessionEnded);
export const $presetPending = $mutation.map((mutation) => mutation?.kind === 'savePreset' || mutation?.kind === 'managePreset');
export const $keyPending = $mutation.map((mutation) => mutation?.kind === 'addKey' || mutation?.kind === 'deleteKey');

const connectionLoadDone = inActiveSession(loadConnectionFx.done, ({ session }) => session);
const connectionLoadFailed = inActiveSession(loadConnectionFx.fail, ({ session }) => session);
const connectionMutationDone = inActiveSession(mutateConnectionFx.done, ({ page }) => page.session);
const connectionMutationFailed = inActiveSession(mutateConnectionFx.fail, ({ page }) => page.session);

const loadDone = sample({
  clock: connectionLoadDone,
  source: $page,
  filter: (page, { params }) => page === params,
  fn: (_, { result }) => result,
});
const loadFailed = sample({
  clock: connectionLoadFailed,
  source: $page,
  filter: (page, { params }) => page === params,
  fn: (_, { params, error }) => ({ session: params.session, error }),
});
const mutationApplied = sample({
  clock: connectionMutationDone,
  source: { page: $page, editorVersion: $editorVersion },
  filter: ({ page }, { params }) => page === params.page,
  fn: ({ editorVersion }, { params, result }) => ({ result, editorCurrent: editorVersion === params.editorVersion }),
});
const mutationDone = mutationApplied.map(({ result }) => result);
const editorMutationDone = mutationApplied.filterMap(({ result, editorCurrent }) => editorCurrent ? result : undefined);
const mutationFailed = sample({
  clock: connectionMutationFailed,
  source: { page: $page, editorVersion: $editorVersion },
  filter: ({ page, editorVersion }, { params }) => page === params.page && editorVersion === params.editorVersion,
  fn: (_, { params, error }) => ({ kind: params.mutation.kind, code: errorCode(error) }),
});

export const $connectionLoad = createStore<LoadState>({ status: 'loading' })
  .on(loadConnectionFx, () => ({ status: 'loading' }))
  .on(loadDone, (_, data) => ({ status: 'ready', data }))
  .on(loadFailed, (_, { error }) => ({ status: 'error', code: errorCode(error) }))
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

// A write can finish after leaving settings. On re-entry, load only after it settles.
sample({
  clock: mutateConnectionFx.finally,
  source: $page,
  filter: (page, { params }) => page !== null && page !== params.page && page.session === params.page.session,
  fn: (page) => page!,
  target: loadConnectionFx,
});
sample({ clock: loadFailed, target: protectedRequestFailed });
sample({
  clock: connectionMutationFailed,
  fn: ({ params, error }) => ({ session: params.page.session, error }),
  target: protectedRequestFailed,
});

const $data = $connectionLoad.map((load) => load.status === 'ready' ? load.data : null);
const $presetId = $data.map((data) => data?.activePresetId ?? '');
const $activePreset = $data.map((data) => data?.presets.find((preset) => preset.id === data.activePresetId) ?? null);
const $editedDraft = createStore<ConnectionDraft | null>(null).reset(pageDeactivated);
const $draft = combine($editedDraft, $activePreset, (edited, preset) => edited ?? createDraft(preset ?? undefined));
const $providerKeys = combine($data, $draft, (data, draft) => data?.keys.filter(({ provider }) => provider === draft.provider) ?? []);
const $keyId = combine($draft, $providerKeys, (draft, keys) => keys.some(({ id }) => id === draft.keyId) ? draft.keyId : '');

export const $connectionSelection = combine({
  presetId: $presetId, activePreset: $activePreset, draft: $draft,
  providerKeys: $providerKeys, keyId: $keyId,
});

const providerChanged = sample({
  clock: connectionProviderChanged,
  source: $draft,
  filter: (draft, provider) => provider !== draft.provider,
  fn: (draft, provider): Partial<ConnectionDraft> => ({
    provider, model: '', keyId: '', baseUrl: '', topK: providers[provider].topK ? draft.topK : '',
  }),
});

const draftChanged = sample({
  clock: [connectionDraftChanged, providerChanged],
  source: $draft,
  fn: (draft, change) => {
    const next = { ...draft, ...change };
    const providerChanged = draft.provider !== next.provider;
    const modelChanged = draft.model.trim() !== next.model.trim();
    const keyChanged = draft.keyId !== next.keyId;
    if (providerChanged || modelChanged) next.openrouterProvider = '';
    return {
      draft: next,
      resetCatalog: keyChanged || providerChanged || draft.baseUrl.trim() !== next.baseUrl.trim(),
      resetEndpoints: keyChanged || providerChanged || modelChanged,
    };
  },
});

const keyAppliedToDraft = sample({
  clock: editorMutationDone,
  source: $connectionSelection,
  filter: ({ presetId, draft }, result) => result.kind === 'addKey' && result.presetId === presetId && result.key.provider === draft.provider,
  fn: ({ draft }, result) => ({ draft: { ...draft, keyId: result.kind === 'addKey' ? result.key.id : draft.keyId } }),
});

const presetAppliedOrDeleted = mutationDone.filter({
  fn: (result) => result.kind === 'managePreset'
    && (result.action.kind === 'apply' || result.action.kind === 'delete'),
});

$editedDraft
  .on([draftChanged, keyAppliedToDraft], (_, { draft }) => draft)
  .reset(presetAppliedOrDeleted, mutationDone.filter({ fn: (result) => result.kind === 'savePreset' }));

sample({ clock: [presetAppliedOrDeleted, editorReset], target: [catalogInvalidated, endpointsInvalidated] });
sample({ clock: draftChanged, filter: ({ resetCatalog }) => resetCatalog, target: catalogInvalidated });
sample({ clock: draftChanged, filter: ({ resetEndpoints }) => resetEndpoints, target: endpointsInvalidated });
sample({
  clock: editorMutationDone,
  filter: (result) => result.kind === 'addKey' || result.kind === 'deleteKey',
  target: [catalogInvalidated, endpointsInvalidated],
});

const $actionContext = combine({
  selection: $connectionSelection, page: $page, pending: $mutation, load: $connectionLoad,
  catalog: $modelCatalog, endpoints: $openRouterEndpoints, editorVersion: $editorVersion,
});

export const connectionPresetChangeFx = attach({
  source: $actionContext,
  async effect({ selection, page, pending, load, catalog, endpoints, editorVersion }, action: PresetAction) {
    if (!page || pending || load.status !== 'ready') return false;
    let mutation: Mutation;
    if (action.kind === 'create' || action.kind === 'update') {
      if (catalog.status === 'loading' || endpoints.status === 'loading') return false;
      const name = action.kind === 'create' ? readPresetName(action.name)
        : selection.activePreset?.id === action.id ? selection.activePreset.name : undefined;
      if (!name) throw new ApiError(400, action.kind === 'create' ? 'preset_name_invalid' : 'preset_not_found');
      const result = validateDraft(selection.draft, selection.keyId, name);
      if ('code' in result) throw new ApiError(400, result.code);
      mutation = { kind: 'savePreset', id: action.kind === 'update' ? action.id : '', preset: result.preset };
    } else {
      mutation = { kind: 'managePreset', action };
    }
    await mutateConnectionFx({ page, mutation, editorVersion });
    return !page.controller.signal.aborted;
  },
});

sample({
  clock: connectionModelsRequested,
  source: $actionContext,
  filter: ({ page, pending, load }) => page !== null && !pending && load.status === 'ready',
  fn: ({ page, selection: { draft, keyId } }) => ({
    session: page!.session, provider: draft.provider, keyId, baseUrl: draft.provider === 'custom' ? draft.baseUrl.trim() : undefined,
  }),
  target: catalogRequested,
});
sample({
  clock: connectionEndpointsRequested,
  source: $actionContext,
  filter: ({ page, pending, load, selection }) => page !== null && !pending && load.status === 'ready' && selection.draft.provider === 'openrouter',
  fn: ({ page, selection: { draft, keyId } }) => ({ session: page!.session, model: draft.model.trim(), keyId }),
  target: endpointsRequested,
});

type PreparedAction = { mutation: Mutation } | { code: ErrorCode };
function prepareAction({ draft, presetId }: StoreValue<typeof $connectionSelection>, action: KeyAction): PreparedAction {
  switch (action.kind) {
    case 'addKey': {
      const name = readConnectionName(action.name);
      const apiKey = typeof action.apiKey === 'string' ? action.apiKey.trim() : '';
      if (!name || !isApiKey(apiKey) || name.includes(apiKey)) {
        return { code: 'provider_key_invalid' };
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
  filter: ({ page, pending, load, selection }, action) => {
    if (!page || pending || load.status !== 'ready') return false;
    if (action.kind === 'deleteKey') return selection.providerKeys.some(({ id }) => id === action.id);
    return true;
  },
  fn: ({ page, selection, editorVersion }, action) => ({ page: page!, editorVersion, result: prepareAction(selection, action) }),
});
const invalidAction = actionPrepared.filterMap(({ result }) => 'mutation' in result ? undefined : result);
const preparedMutation = actionPrepared.filterMap(({ page, editorVersion, result }): MutationRequest | undefined =>
  'mutation' in result ? { page, editorVersion, mutation: result.mutation } : undefined);
sample({ clock: preparedMutation, target: mutateConnectionFx });

export const $keySubmission = createStore<KeySubmission>({ status: 'idle' })
  .on(invalidAction, (_, { code }) => ({ status: 'error', code }))
  .on(editorMutationDone, (current, result) => {
    if (result.kind === 'addKey') return { status: 'added' };
    if (result.kind === 'deleteKey') return { status: 'removed' };
    return current;
  })
  .on(mutationFailed, (current, { kind, code }) => kind === 'addKey' || kind === 'deleteKey'
    ? { status: 'error', code } : current)
  .on(mutateConnectionFx, (current, { mutation }) => mutation.kind === 'addKey' || mutation.kind === 'deleteKey'
    ? { status: 'idle' } : current)
  .on(keyErrorCleared, (current) => current.status === 'error' ? { status: 'idle' } : current)
  .reset(keyManagerOpened, keyDeleteOpened, editorReset);

export const $keyManagerOpen = createStore(false)
  .on(keyManagerOpened, () => true)
  .on(editorMutationDone, (open, result) => result.kind === 'addKey' ? false : open)
  .reset(keyManagerClosed, editorReset);

export const $keyBeingDeleted = createStore<ProviderKey | null>(null)
  .on(keyDeleteOpened, (_, key) => key)
  .on(mutationDone, (key, result) => result.kind === 'deleteKey' ? null : key)
  .reset(keyManagerOpened, keyManagerClosed, keyDeleteClosed, editorReset);
