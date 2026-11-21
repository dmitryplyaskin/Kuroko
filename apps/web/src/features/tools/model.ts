import { createEffect, createEvent, createStore, sample } from 'effector';
import type { ToolId, ToolsResponse } from '@kuroko/contracts/tools';
import { $activeSession, protectedRequestFailed, sessionEnded, sessionStarted, type ActiveSession } from '../../platform/session/model';
import { inActiveSession, sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';

type Change = { id: ToolId; enabled: boolean };
type Preferences = {
  status: 'idle' | 'loading' | 'ready' | 'loadError' | 'saving';
  enabled: ToolId[];
  error?: ErrorCode;
};

const path = '/settings/tools';
const initial: Preferences = { status: 'idle', enabled: [] };
export const toolsInitialized = createEvent();
export const toolSettingsRetried = createEvent();
export const toolSettingChanged = createEvent<Change>();

const $initialized = createStore(false).on(toolsInitialized, () => true);
export const loadToolSettingsFx = createEffect((session: ActiveSession) => sessionRequest<ToolsResponse>(session, path));
const saveToolSettingFx = createEffect(({ session, change }: { session: ActiveSession; change: Change }) =>
  sessionRequest<ToolsResponse>(session, `${path}/${change.id}`, { method: 'PUT', body: { enabled: change.enabled } }));

const loaded = inActiveSession(loadToolSettingsFx.done, (session) => session);
const saved = inActiveSession(saveToolSettingFx.done, ({ session }) => session);
const loadFailed = inActiveSession(loadToolSettingsFx.fail, (session) => session)
  .map(({ params: session, error }) => ({ session, error }));
const saveFailed = inActiveSession(saveToolSettingFx.fail, ({ session }) => session)
  .map(({ params: { session }, error }) => ({ session, error }));

export const $toolSettings = createStore<Preferences>(initial)
  .on(loadToolSettingsFx, (current) => ({ status: 'loading', enabled: current.enabled }))
  .on(saveToolSettingFx, (current) => ({ status: 'saving', enabled: current.enabled }))
  .on([loaded, saved], (_, { result }) => ({ status: 'ready', enabled: result.enabled }))
  .on(loadFailed, (current, { error }) => ({ ...current, status: 'loadError', error: errorCode(error) }))
  .on(saveFailed, (current, { error }) => ({ ...current, status: 'ready', error: errorCode(error) }))
  .reset(sessionEnded);

export const $enabledTools = $toolSettings.map(({ enabled }) => enabled);
export const $toolSettingsBusy = $toolSettings.map(({ status }) => status === 'loading' || status === 'saving');

sample({ clock: sessionStarted, filter: $initialized, target: loadToolSettingsFx });
sample({
  clock: toolSettingsRetried,
  source: { session: $activeSession, settings: $toolSettings },
  filter: ({ session, settings }) => session !== null && settings.status === 'loadError',
  fn: ({ session }) => session!,
  target: loadToolSettingsFx,
});
sample({
  clock: toolSettingChanged,
  source: { session: $activeSession, settings: $toolSettings },
  filter: ({ session, settings }, { id, enabled }) => session !== null && settings.status === 'ready' && settings.enabled.includes(id) !== enabled,
  fn: ({ session }, change) => ({ session: session!, change }),
  target: saveToolSettingFx,
});
sample({ clock: [loadFailed, saveFailed], target: protectedRequestFailed });
