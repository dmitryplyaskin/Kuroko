import type { ConnectionState, OpenRouterEndpoint, Provider, ProviderKey, ProviderModel, SaveConnectionPreset, UpdateConnectionPreset } from '@kuroko/contracts/connectionSettings';
import type { PresetManagementAction } from '@kuroko/contracts/presets';
import type { ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';
import { requestPresetAction } from '../../platform/presets';

const path = '/settings/connection';
const presetsPath = `${path}/presets`;
const keysPath = (provider: Provider) => `${path}/keys/${provider}`;

export const connectionApi = {
  load: (session: ActiveSession, signal: AbortSignal) => sessionRequest<ConnectionState>(session, path, { signal }),
  createPreset: (session: ActiveSession, preset: SaveConnectionPreset) =>
    sessionRequest<ConnectionState>(session, presetsPath, { method: 'POST', body: preset }),
  updatePreset: (session: ActiveSession, id: string, preset: UpdateConnectionPreset) =>
    sessionRequest<ConnectionState>(session, `${presetsPath}/${encodeURIComponent(id)}`, { method: 'PUT', body: preset }),
  managePreset: (session: ActiveSession, action: PresetManagementAction) =>
    requestPresetAction<ConnectionState>(session, presetsPath, action),
  models: (session: ActiveSession, provider: Provider, keyId: string, baseUrl: string | undefined, signal: AbortSignal) =>
    sessionRequest<{ models: ProviderModel[] }>(session, `${path}/models`, { method: 'POST', body: { provider, keyId, baseUrl }, signal }),
  endpoints: (session: ActiveSession, model: string, keyId: string, signal: AbortSignal) =>
    sessionRequest<{ endpoints: OpenRouterEndpoint[] }>(session, `${path}/openrouter/endpoints`, { method: 'POST', body: { model, keyId }, signal }),
  addKey: (session: ActiveSession, provider: Provider, name: string, apiKey: string) =>
    sessionRequest<ProviderKey>(session, keysPath(provider), { method: 'POST', body: { name, apiKey } }),
  deleteKey: (session: ActiveSession, provider: Provider, id: string) =>
    sessionRequest<ConnectionState>(session, `${keysPath(provider)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
