import { attach, combine, createEffect, createEvent, createStore, sample } from 'effector';
import { isAgentToolId, type AgentToolId, type ToolId, type ToolPreset, type ToolsResponse } from '@kuroko/contracts/tools';
import type { PresetAction } from '@kuroko/contracts/presets';
import { inActiveSession, $activeSession, protectedRequestFailed, sessionEnded, sessionStarted, type ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { createPresetControlsModel, requestPresetAction } from '../../platform/presets';

type Toggle = { id: ToolId; enabled: boolean };
type Change = { kind: 'toggle'; tool: Toggle } | { kind: 'clear' } | { kind: 'subagent'; presetId: string | null }
  | { kind: 'temporaryAgentTools'; tools: AgentToolId[] | null } | PresetAction;
type Preferences = {
  status: 'idle' | 'loading' | 'ready' | 'loadError' | 'saving';
  enabled: ToolId[];
  presets: ToolPreset[];
  activePresetId: string | null;
  temporaryAgentTools?: AgentToolId[];
  subagent?: ToolsResponse['subagent'];
  error?: ErrorCode;
};

const path = '/settings/tools';
const presetsPath = `${path}/presets`;
const initial: Preferences = { status: 'idle', enabled: [], presets: [], activePresetId: null };
export const toolsInitialized = createEvent();
export const toolManagerOpened = createEvent();
export const toolSettingsRetried = createEvent();
export const toolSettingChanged = createEvent<Toggle>();
export const temporaryAgentToolsChanged = createEvent<AgentToolId[]>();
export const temporaryAgentToolsSaveRequested = createEvent();
export const temporaryAgentToolsResetRequested = createEvent();

const $initialized = createStore(false).on(toolsInitialized, () => true);
export const loadToolSettingsFx = createEffect((session: ActiveSession) => sessionRequest<ToolsResponse>(session, path));
const saveToolSettingFx = createEffect(({ session, change, enabled }: { session: ActiveSession; change: Change; enabled: ToolId[] }) => {
  switch (change.kind) {
    case 'toggle':
      return sessionRequest<ToolsResponse>(session, `${path}/${encodeURIComponent(change.tool.id)}`,
        { method: 'PUT', body: { enabled: change.tool.enabled } });
    case 'clear':
      return sessionRequest<ToolsResponse>(session, `${path}/enabled`, { method: 'DELETE' });
    case 'subagent':
      return sessionRequest<ToolsResponse>(session, `${path}/subagent-connection`, { method: 'PUT', body: { presetId: change.presetId } });
    case 'temporaryAgentTools':
      return sessionRequest<ToolsResponse>(session, `${path}/temporary-agent-tools`, { method: 'PUT', body: { tools: change.tools } });
    case 'create':
      return sessionRequest<ToolsResponse>(session, presetsPath, { method: 'POST', body: { name: change.name, enabled, apply: true } });
    case 'update':
      return sessionRequest<ToolsResponse>(session, `${presetsPath}/${encodeURIComponent(change.id)}`, { method: 'PUT', body: { enabled } });
    default:
      return requestPresetAction<ToolsResponse>(session, presetsPath, change);
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
  .on([loaded, saved], (_, { result }) => ({
    status: 'ready', enabled: result.enabled, presets: result.presets ?? [], activePresetId: result.activePresetId ?? null,
    subagent: result.subagent, temporaryAgentTools: result.temporaryAgentTools,
  }))
  .on(loadFailed, (current, { error }) => ({ ...current, status: 'loadError', error: errorCode(error) }))
  .on(saveFailed, (current, { change, error }) => ({
    ...current, status: 'ready', error: change.kind === 'toggle' || change.kind === 'clear' || change.kind === 'subagent' || change.kind === 'temporaryAgentTools'
      ? errorCode(error) : undefined,
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

export const toolPresetControls = createPresetControlsModel(toolSettingsChangeFx);

const temporaryToolsSaved = saved.filter({ fn: ({ params }) => params.change.kind === 'temporaryAgentTools' });
const temporaryDraftDiscarded = sample({
  clock: temporaryAgentToolsResetRequested,
  filter: $toolSettings.map(({ temporaryAgentTools, status }) => status === 'ready' && temporaryAgentTools === undefined),
});
const draftChanged = sample({
  clock: temporaryAgentToolsChanged,
  filter: $toolSettings.map(({ status }) => status === 'ready'),
});
const $temporaryAgentToolsDraft = createStore<AgentToolId[] | null>(null)
  .on(draftChanged, (_, draft) => draft)
  .reset(temporaryDraftDiscarded, temporaryToolsSaved, sessionEnded);

export const $temporaryAgentToolsSelection = combine($toolSettings, $temporaryAgentToolsDraft, (settings, draft) => {
  const configured = settings.temporaryAgentTools;
  const applied = configured ?? settings.enabled.filter(isAgentToolId);
  const dirty = draft !== null && (!configured || draft.length !== applied.length || draft.some((id) => !applied.includes(id)));
  return { selection: draft ?? applied, dirty, configured: configured !== undefined };
});
export const $temporaryAgentToolsDirty = $temporaryAgentToolsSelection.map(({ dirty }) => dirty);
export const $subagentSetupNeeded = $toolSettings.map(({ status, enabled, subagent }) =>
  status === 'ready' && (!enabled.includes('subagent') || !subagent?.presetId));
export const $toolSettingsLoadFailed = $toolSettings.map(({ status }) => status === 'loadError');

sample({
  clock: temporaryAgentToolsSaveRequested,
  source: $temporaryAgentToolsSelection,
  filter: ({ dirty }) => dirty,
  fn: ({ selection }): Change => ({ kind: 'temporaryAgentTools', tools: selection }),
  target: toolSettingsChangeFx,
});
sample({
  clock: temporaryAgentToolsResetRequested,
  filter: $toolSettings.map(({ temporaryAgentTools }) => temporaryAgentTools !== undefined),
  fn: (): Change => ({ kind: 'temporaryAgentTools', tools: null }),
  target: toolSettingsChangeFx,
});

export const $enabledTools = $toolSettings.map(({ enabled }) => enabled);
export const $toolSettingsReady = $toolSettings.map(({ status }) => status === 'ready');

sample({ clock: sessionStarted, filter: $initialized, target: loadToolSettingsFx });
sample({
  clock: toolManagerOpened,
  source: { session: $activeSession, settings: $toolSettings },
  filter: ({ session, settings }) => session !== null && settings.status === 'ready',
  fn: ({ session }) => session!,
  target: loadToolSettingsFx,
});
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
