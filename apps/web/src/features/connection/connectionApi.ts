import type { ConnectionState, Provider, ProviderKey, ProviderModel, SaveConnectionPreset } from '@kuroko/contracts/connectionSettings';
import { api } from '../../shared/http/api';

const path = '/settings/connection';
const presetsPath = `${path}/presets`;
const keysPath = (provider: Provider) => `${path}/keys/${provider}`;

export const connectionApi = {
  load: (account: number, signal: AbortSignal) => api<ConnectionState>(path, { account, signal }),
  savePreset: (account: number, id: string, preset: SaveConnectionPreset) => api<ConnectionState>(
    id ? `${presetsPath}/${encodeURIComponent(id)}` : presetsPath,
    { method: id ? 'PUT' : 'POST', account, body: preset },
  ),
  deletePreset: (account: number, id: string) =>
    api<ConnectionState>(`${presetsPath}/${encodeURIComponent(id)}`, { method: 'DELETE', account }),
  models: (account: number, provider: Provider, keyId: string, signal: AbortSignal) =>
    api<{ models: ProviderModel[] }>(`${path}/models`, { method: 'POST', account, body: { provider, keyId }, signal }),
  addKey: (account: number, provider: Provider, name: string, apiKey: string) =>
    api<ProviderKey>(keysPath(provider), { method: 'POST', account, body: { name, apiKey } }),
  deleteKey: (account: number, provider: Provider, id: string) =>
    api<ConnectionState>(`${keysPath(provider)}/${encodeURIComponent(id)}`, { method: 'DELETE', account }),
};
