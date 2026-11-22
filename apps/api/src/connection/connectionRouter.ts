import { errorBody } from '@kuroko/contracts/errors';
import { readPresetName } from '@kuroko/contracts/presets';
import { Router, type RequestHandler } from 'express';
import {
  isApiKey, isModelId, isProvider, readConnectionName, readConnectionSettings, readCustomBaseUrl,
} from '@kuroko/contracts/connectionSettings';
import type { createConnectionStore } from './connectionStore';
import type { ProviderConnections } from './providerConnections';
import { listOpenRouterEndpoints, listProviderModels } from './providerModels';
import type { ProviderKeyStore } from './providerKeyStore';
import { createPresetRouter, respondToPresetWrite } from '../http/presetRouter';

const missingKey = errorBody('provider_key_not_found');

export function createConnectionRouter(
  store: ReturnType<typeof createConnectionStore>, keys: ProviderKeyStore, connections: ProviderConnections,
) {
  const router = Router();
  const save: RequestHandler<{ id?: string }> = (request, response) => {
    const provider: unknown = request.body?.provider;
    const name = readPresetName(request.body?.name);
    if (!name) {
      response.status(400).json(errorBody('preset_name_invalid', 'name'));
      return;
    }
    if (provider === 'custom' && !readCustomBaseUrl(request.body?.settings?.baseUrl)) {
      response.status(400).json(errorBody('custom_api_url_invalid', 'baseUrl'));
      return;
    }
    const settings = isProvider(provider) ? readConnectionSettings(provider, request.body.settings) : undefined;
    const keyId: unknown = request.body?.keyId;
    if (!isProvider(provider) || !settings || (keyId !== null && !isIdentifier(keyId))) {
      response.status(400).json(errorBody('preset_settings_invalid'));
      return;
    }

    const userId: number = response.locals.user.id;
    const id = request.params.id ?? null;
    const result = store.save(userId, id, { name, provider, settings, keyId });
    if (result === 'missing-key') response.status(404).json(missingKey);
    else respondToPresetWrite(response, result, () => store.read(userId), id ? 200 : 201);
  };

  router.get('/', (_request, response) => { response.json(store.read(response.locals.user.id)); });
  router.post('/presets', save);
  router.put('/presets/:id', save);
  router.use('/presets', createPresetRouter(store));

  router.post('/keys/:provider', (request, response) => {
    const { provider } = request.params;
    const name = readConnectionName(request.body?.name);
    const apiKey: unknown = request.body?.apiKey;
    if (!isProvider(provider) || !name || !isApiKey(apiKey) || name.includes(apiKey)) {
      response.status(400).json(errorBody('provider_key_invalid'));
      return;
    }

    const key = keys.create(response.locals.user.id, provider, name, apiKey);
    if (!key) {
      response.status(409).json(errorBody('provider_key_name_taken'));
      return;
    }
    response.status(201).json(key);
  });

  router.delete('/keys/:provider/:id', (request, response) => {
    const { provider, id } = request.params;
    const userId: number = response.locals.user.id;
    if (!isProvider(provider) || !keys.remove(userId, provider, id)) {
      response.status(404).json(missingKey);
      return;
    }
    response.json(store.read(userId));
  });

  router.post('/models', async (request, response) => {
    const provider: unknown = request.body?.provider;
    const keyId: unknown = request.body?.keyId;
    const anonymous = provider === 'custom' && (keyId === null || keyId === '');
    if (!isProvider(provider) || (!anonymous && !isIdentifier(keyId))) {
      response.status(400).json(errorBody('model_catalog_selection_invalid'));
      return;
    }
    const baseUrl = provider === 'custom' ? readCustomBaseUrl(request.body?.baseUrl) : undefined;
    if (provider === 'custom' && !baseUrl) {
      response.status(400).json(errorBody('custom_api_url_invalid', 'baseUrl'));
      return;
    }

    const apiKey = anonymous ? '' : isIdentifier(keyId) ? keys.getForProvider(response.locals.user.id, provider, keyId)?.trim() : undefined;
    if (apiKey === undefined) {
      response.status(404).json(missingKey);
      return;
    }
    if (!anonymous && !isApiKey(apiKey)) {
      response.status(400).json(errorBody('model_catalog_key_invalid'));
      return;
    }

    const result = await listProviderModels(provider, apiKey, connections, baseUrl);
    if ('code' in result) response.status(result.status).json(errorBody(result.code));
    else response.json({ models: result.models.filter(({ id }) => !apiKey || !id.includes(apiKey)) });
  });

  router.post('/openrouter/endpoints', async (request, response) => {
    const { model, keyId } = request.body ?? {};
    if (!isModelId(model) || !isIdentifier(keyId)) {
      response.status(400).json(errorBody('model_catalog_selection_invalid'));
      return;
    }
    const apiKey = keys.getForProvider(response.locals.user.id, 'openrouter', keyId)?.trim();
    if (!isApiKey(apiKey)) {
      response.status(404).json(missingKey);
      return;
    }
    const endpoints = await listOpenRouterEndpoints(model, apiKey, connections.openrouter);
    if (!endpoints) response.status(424).json(errorBody('openrouter_endpoints_unavailable'));
    else response.json({ endpoints });
  });

  return router;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d-]{32,36}$/i.test(value);
}
