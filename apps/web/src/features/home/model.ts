import { defaultRealmFilters } from '@kuroko/contracts/realms';
import { createEffect, createEvent, createStore, sample } from 'effector';
import { $activeSession, inActiveSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { abortFx } from '../../shared/async/abort';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { chatApi } from '../chat/chatApi';
import { connectionApi } from '../connection/connectionApi';
import { requestInstructionSettings } from '../instructions/model';
import { requestPersonaSelection } from '../personas/selectionModel';
import { requestRealmList } from '../realms/model';

type Section = 'chats' | 'realms' | 'connection' | 'persona' | 'instruction';
type Visit = { session: ActiveSession; controller: AbortController };
export type HomeQuery<Data> = { status: 'loading' } | { status: 'ready'; data: Data } | { status: 'error'; code: ErrorCode };

export const homeOpened = createEvent();
export const homeClosed = createEvent();
export const homeRetryRequested = createEvent<Section>();
export const recentLimit = 4;

const visitStarted = sample({
  clock: homeOpened,
  source: $activeSession,
  filter: (session) => session !== null,
  fn: (session): Visit => ({ session: session!, controller: new AbortController() }),
});
const $visit = createStore<Visit | null>(null).on(visitStarted, (_, visit) => visit);
const visitEnded = sample({ clock: [homeClosed, sessionEnded], source: $visit });
$visit.reset(visitEnded);
sample({
  clock: visitEnded.filterMap((visit) => visit?.controller),
  target: abortFx,
});

function createHomeQuery<Data>(section: Section, request: (visit: Visit) => Promise<Data>) {
  const loadFx = createEffect(request);
  const finished = inActiveSession(loadFx.finally, ({ session }) => session);
  const currentResult = sample({
    clock: finished,
    source: $visit,
    filter: (visit, { params }) => visit === params && !params.controller.signal.aborted,
    fn: (_, result) => result,
  });
  const $query = createStore<HomeQuery<Data>>({ status: 'loading' })
    .on(loadFx, () => ({ status: 'loading' }))
    .on(currentResult, (_, result) => result.status === 'done'
      ? { status: 'ready', data: result.result } : { status: 'error', code: errorCode(result.error) })
    .reset(visitEnded);

  sample({ clock: visitStarted, target: loadFx });
  sample({
    clock: homeRetryRequested,
    source: { visit: $visit, query: $query },
    filter: ({ visit, query }, requested) => visit !== null && query.status === 'error' && requested === section,
    fn: ({ visit }) => visit!,
    target: loadFx,
  });
  sample({
    clock: currentResult.filterMap((result) => result.status === 'fail' ? { session: result.params.session, error: result.error } : undefined),
    target: protectedRequestFailed,
  });
  return $query;
}

export const $recentChats = createHomeQuery('chats', async ({ session, controller }) =>
  (await chatApi.list(session, controller.signal)).slice(0, recentLimit));
export const $recentRealms = createHomeQuery('realms', async ({ session, controller }) =>
  (await requestRealmList({
    session, signal: controller.signal,
    query: { q: '', sort: 'updated', limit: recentLimit, offset: 0, filters: defaultRealmFilters },
  })).items);
export const $activeConnection = createHomeQuery('connection', async ({ session, controller }) => {
  const { activePresetId, presets, keys } = await connectionApi.load(session, controller.signal);
  const preset = presets.find(({ id }) => id === activePresetId);
  if (!preset) return null;
  const needsKey = preset.provider !== 'custom' && !keys.some(({ id, provider }) => id === preset.keyId && provider === preset.provider);
  return { name: preset.name, model: preset.model, provider: preset.provider, needsKey };
});
export const $activePersona = createHomeQuery('persona', async ({ session, controller }) => {
  const persona = await requestPersonaSelection(session, controller.signal);
  return persona.id === null ? null : persona;
});
export const $activeInstruction = createHomeQuery('instruction', async ({ session, controller }) => {
  const { activePresetId, presets } = await requestInstructionSettings(session, controller.signal);
  const preset = presets.find(({ id }) => id === activePresetId);
  return preset ? { name: preset.name, worldTitle: preset.worldTitle } : null;
});
