import { attach, createEffect, createEvent, createStore, sample } from 'effector';
import type { ToolId, ToolPreset, ToolsResponse } from '@kuroko/contracts/tools';
import { $activeSession, protectedRequestFailed, sessionEnded, sessionStarted, type ActiveSession } from '../../platform/session/model';
import { inActiveSession, sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';

type Toggle = { id: ToolId; enabled: boolean };
type Change = { kind: 'toggle'; tool: Toggle } | { kind: 'clear' }
  | { kind: 'savePreset'; name: string } | { kind: 'applyPreset' | 'deletePreset'; id: string };
type Preferences = {
  status: 'idle' | 'loading' | 'ready' | 'loadError' | 'saving';
  enabled: ToolId[];
  presets: ToolPreset[];
  error?: ErrorCode;
};

const path = '/settings/tools';
const initial: Preferences = { status: 'idle', enabled: [], presets: [] };
export const toolsInitialized = createEvent();
export const toolSettingsRetried = createEvent();
export const toolSettingChanged = createEvent<Toggle>();

const $initialized = createStore(false).on(toolsInitialized, () => true);
export const loadToolSettingsFx = createEffect((session: ActiveSession) => sessionRequest<ToolsResponse>(session, path));
const saveToolSettingFx = createEffect(({ session, change, enabled }: { session: ActiveSession; change: Change; enabled: ToolId[] }) => {
  switch (change.kind) {
    case 'toggle':
      return sessionRequest<ToolsResponse>(session, `${path}/${encodeURIComponent(change.tool.id)}`,
        { method: 'PUT', body: { enabled: change.tool.enabled } });
    case 'clear':
      return sessionRequest<ToolsResponse>(session, `${path}/enabled`, { method: 'DELETE' });
    case 'savePreset':
      return sessionRequest<ToolsResponse>(session, `${path}/presets`, { method: 'POST', body: { name: change.name, enabled } });
    case 'applyPreset':
      return sessionRequest<ToolsResponse>(session, `${path}/presets/${encodeURIComponent(change.id)}/apply`, { method: 'PUT' });
    case 'deletePreset':
      return sessionRequest<ToolsResponse>(session, `${path}/presets/${encodeURIComponent(change.id)}`, { method: 'DELETE' });
  }
});

const loaded = inActiveSession(loadToolSettingsFx.done, (session) => session);
const saved = inActiveSession(saveToolSettingFx.done, ({ session }) => session);
const loadFailed = inActiveSession(loadToolSettingsFx.fail, (session) => session)
  .map(({ params: session, error }) => ({ session, error }));
const saveFailed = inActiveSession(saveToolSettingFx.fail, ({ session }) => session)
  .map(({ params: { session, change }, error }) => ({ session, change, error }));

export const $toolSettings = createStore<Preferences>(initial)
  .on(loadToolSettingsFx, (current) => ({ ...current, status: 'loading', error: undefined }))
  .on(saveToolSettingFx, (current) => ({ ...current, status: 'saving', error: undefined }))
  .on([loaded, saved], (_, { result }) => ({ status: 'ready', enabled: result.enabled, presets: result.presets ?? [] }))
  .on(loadFailed, (current, { error }) => ({ ...current, status: 'loadError', error: errorCode(error) }))
  .on(saveFailed, (current, { change, error }) => ({
    ...current, status: 'ready', error: change.kind === 'savePreset' || change.kind === 'deletePreset' ? undefined : errorCode(error),
  }))
  .reset(sessionEnded);

export const toolSettingsChangeFx = attach({
  source: { session: $activeSession, settings: $toolSettings },
  async effect({ session, settings }, change: Change) {
    if (!session || settings.status !== 'ready') return;
    if (change.kind === 'toggle' && settings.enabled.includes(change.tool.id) === change.tool.enabled) return;
    if (change.kind === 'clear' && settings.enabled.length === 0) return;
    const result = await saveToolSettingFx({ session, change, enabled: settings.enabled });
    if (!session.signal.aborted) return result;
  },
});

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
  fn: (tool): Change => ({ kind: 'toggle', tool }),
  target: toolSettingsChangeFx,
});
sample({ clock: [loadFailed, saveFailed], target: protectedRequestFailed });
