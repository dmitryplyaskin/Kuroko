import { Router, type RequestHandler } from 'express';
import {
  isApiKey, isProvider, readConnectionName, readConnectionSettings,
} from '@kuroko/contracts/connectionSettings';
import type { createConnectionStore } from './connectionStore';
import { listProviderModels } from './providerModels';
import type { ProviderKeyStore } from './providerKeyStore';

const missingKey = { error: 'Ключ не найден. Выберите другой ключ для этого провайдера.' };

export function createConnectionRouter(store: ReturnType<typeof createConnectionStore>, keys: ProviderKeyStore) {
  const router = Router();
  const save: RequestHandler<{ id?: string }> = (request, response) => {
    const provider: unknown = request.body?.provider;
    const name = readConnectionName(request.body?.name);
    if (!name) {
      response.status(400).json({ error: 'Введите название пресета длиной до 120 символов.' });
      return;
    }
    const settings = isProvider(provider) ? readConnectionSettings(provider, request.body.settings) : undefined;
    const keyId: unknown = request.body?.keyId;
    if (!isProvider(provider) || !settings || (keyId !== null && !isIdentifier(keyId))) {
      response.status(400).json({ error: 'Проверьте модель, ключ, параметры генерации и лимиты.' });
      return;
    }

    const userId: number = response.locals.user.id;
    const id = request.params.id ?? null;
    const result = store.save(userId, id, { name, provider, settings, keyId });
    if (result === 'missing-preset') response.status(404).json({ error: 'Пресет не найден. Обновите вкладку.' });
    else if (result === 'missing-key') response.status(404).json(missingKey);
    else if (result === 'duplicate') response.status(409).json({ error: 'Пресет с таким названием уже есть. Введите другое название.' });
    else response.status(id ? 200 : 201).json(store.read(userId));
  };

  router.get('/', (_request, response) => { response.json(store.read(response.locals.user.id)); });
  router.post('/presets', save);
  router.put('/presets/:id', save);

  router.delete('/presets/:id', (request, response) => {
    const userId: number = response.locals.user.id;
    if (!store.remove(userId, request.params.id)) {
      response.status(404).json({ error: 'Пресет не найден. Обновите вкладку.' });
      return;
    }
    response.json(store.read(userId));
  });

  router.post('/keys/:provider', (request, response) => {
    const { provider } = request.params;
    const name = readConnectionName(request.body?.name);
    const apiKey: unknown = request.body?.apiKey;
    if (!isProvider(provider) || !name || !isApiKey(apiKey) || name.includes(apiKey)) {
      response.status(400).json({ error: 'Укажите название ключа и введите API-ключ в отдельное поле.' });
      return;
    }

    const key = keys.create(response.locals.user.id, provider, name, apiKey);
    if (!key) {
      response.status(409).json({ error: 'Ключ с таким названием уже есть у этого провайдера. Введите другое название.' });
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
      response.status(400).json({ error: 'Выберите провайдера и сохранённый API-ключ.' });
      return;
    }

    const apiKey = keys.getForProvider(response.locals.user.id, provider, keyId)?.trim();
    if (apiKey === undefined) {
      response.status(404).json(missingKey);
      return;
    }
    if (!isApiKey(apiKey)) {
      response.status(400).json({ error: 'Этот ключ не подходит для подключения. Выберите другой ключ.' });
      return;
    }

    const result = await listProviderModels(provider, apiKey);
    if ('error' in result) response.status(result.status).json({ error: result.error });
    else response.json({ models: result.models.filter(({ id }) => !id.includes(apiKey)) });
  });

  return router;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f\d-]{32,36}$/i.test(value);
}
