import type { ConnectionState, Provider, ProviderKey, ProviderModel, SaveConnectionPreset } from '@kuroko/contracts/connectionSettings';
import type { ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';

const path = '/settings/connection';
const presetsPath = `${path}/presets`;
const keysPath = (provider: Provider) => `${path}/keys/${provider}`;

export const connectionApi = {
  load: (session: ActiveSession, signal: AbortSignal) => sessionRequest<ConnectionState>(session, path, { signal }),
  savePreset: (session: ActiveSession, id: string, preset: SaveConnectionPreset) => sessionRequest<ConnectionState>(
    session,
    id ? `${presetsPath}/${encodeURIComponent(id)}` : presetsPath,
    { method: id ? 'PUT' : 'POST', body: preset },
  ),
  deletePreset: (session: ActiveSession, id: string) =>
    sessionRequest<ConnectionState>(session, `${presetsPath}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  models: (session: ActiveSession, provider: Provider, keyId: string, signal: AbortSignal) =>
    sessionRequest<{ models: ProviderModel[] }>(session, `${path}/models`, { method: 'POST', body: { provider, keyId }, signal }),
  addKey: (session: ActiveSession, provider: Provider, name: string, apiKey: string) =>
    sessionRequest<ProviderKey>(session, keysPath(provider), { method: 'POST', body: { name, apiKey } }),
  deleteKey: (session: ActiveSession, provider: Provider, id: string) =>
    sessionRequest<ConnectionState>(session, `${keysPath(provider)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
