import { Router } from 'express';
import { errorBody } from '@kuroko/contracts/errors';
import { isToolId, isToolSelection, readToolPresetName } from '@kuroko/contracts/tools';
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
    const name = readToolPresetName(request.body?.name);
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
    if (!store.savePreset(userId, name, enabled)) {
      response.status(409).json(errorBody('preset_name_taken', 'name'));
      return;
    }
    response.status(201).json(store.read(userId));
  });
  router.put('/presets/:id/apply', (request, response) => {
    const userId: number = response.locals.user.id;
    if (!store.applyPreset(userId, request.params.id)) {
      response.status(404).json(errorBody('preset_not_found'));
      return;
    }
    response.json(store.read(userId));
  });
  router.delete('/presets/:id', (request, response) => {
    const userId: number = response.locals.user.id;
    if (!store.removePreset(userId, request.params.id)) {
      response.status(404).json(errorBody('preset_not_found'));
      return;
    }
    response.json(store.read(userId));
  });
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
