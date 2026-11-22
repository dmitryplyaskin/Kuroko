import { Router } from 'express';
import { errorBody } from '@kuroko/contracts/errors';
import { isToolId, isToolSelection } from '@kuroko/contracts/tools';
import { readPresetName } from '@kuroko/contracts/presets';
import { createPresetRouter, respondToPresetWrite } from '../http/presetRouter';
import type { createToolsStore } from './toolsStore';

export function createToolsRouter(store: ReturnType<typeof createToolsStore>) {
  const router = Router();
  router.get('/', (_request, response) => { response.json(store.read(response.locals.user.id)); });
  router.delete('/enabled', (_request, response) => {
    const userId: number = response.locals.user.id;
    store.clear(userId);
    response.json(store.read(userId));
  });
  router.post('/presets', (request, response) => {
    const name = readPresetName(request.body?.name);
    const enabled: unknown = request.body?.enabled;
    if (!name) {
      response.status(400).json(errorBody('preset_name_invalid', 'name'));
      return;
    }
    if (!isToolSelection(enabled)) {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const userId: number = response.locals.user.id;
    const result = store.createPreset(userId, name, enabled, request.body?.apply === true);
    respondToPresetWrite(response, result, () => store.read(userId), 201);
  });
  router.put('/presets/:id', (request, response) => {
    const enabled: unknown = request.body?.enabled;
    if (!isToolSelection(enabled)) {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const userId: number = response.locals.user.id;
    respondToPresetWrite(response, store.savePreset(userId, request.params.id, enabled), () => store.read(userId));
  });
  router.use('/presets', createPresetRouter(store));
  router.put('/:id', (request, response) => {
    const { id } = request.params;
    const enabled: unknown = request.body?.enabled;
    if (!isToolId(id) || typeof enabled !== 'boolean') {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const userId: number = response.locals.user.id;
    store.set(userId, id, enabled);
    response.json(store.read(userId));
  });
  return router;
}
