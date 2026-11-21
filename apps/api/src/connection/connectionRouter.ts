import { errorBody } from '@kuroko/contracts/errors';
import { Router, type RequestHandler } from 'express';
import {
  isApiKey, isProvider, readConnectionName, readConnectionSettings,
} from '@kuroko/contracts/connectionSettings';
import type { createConnectionStore } from './connectionStore';
import type { ProviderConnections } from './providerConnections';
import { listProviderModels } from './providerModels';
import type { ProviderKeyStore } from './providerKeyStore';

const missingKey = errorBody('provider_key_not_found');

export function createConnectionRouter(
  store: ReturnType<typeof createConnectionStore>, keys: ProviderKeyStore, connections: ProviderConnections,
) {
  const router = Router();
  const save: RequestHandler<{ id?: string }> = (request, response) => {
    const provider: unknown = request.body?.provider;
    const name = readConnectionName(request.body?.name);
    if (!name) {
      response.status(400).json(errorBody('preset_name_invalid', 'name'));
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
    if (result === 'missing-preset') response.status(404).json(errorBody('preset_not_found'));
    else if (result === 'missing-key') response.status(404).json(missingKey);
    else if (result === 'duplicate') response.status(409).json(errorBody('preset_name_taken'));
    else response.status(id ? 200 : 201).json(store.read(userId));
  };

  router.get('/', (_request, response) => { response.json(store.read(response.locals.user.id)); });
  router.post('/presets', save);
  router.put('/presets/:id', save);

  router.delete('/presets/:id', (request, response) => {
    const userId: number = response.locals.user.id;
    if (!store.remove(userId, request.params.id)) {
      response.status(404).json(errorBody('preset_not_found'));
      return;
    }
    response.json(store.read(userId));
  });

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
    if (!isProvider(provider) || !isIdentifier(keyId)) {
      response.status(400).json(errorBody('model_catalog_selection_invalid'));
      return;
    }

    const apiKey = keys.getForProvider(response.locals.user.id, provider, keyId)?.trim();
    if (apiKey === undefined) {
      response.status(404).json(missingKey);
      return;
    }
    if (!isApiKey(apiKey)) {
      response.status(400).json(errorBody('model_catalog_key_invalid'));
      return;
    }

    const result = await listProviderModels(provider, apiKey, connections);
    if ('code' in result) response.status(result.status).json(errorBody(result.code));
    else response.json({ models: result.models.filter(({ id }) => !id.includes(apiKey)) });
  });

  return router;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d-]{32,36}$/i.test(value);
}
