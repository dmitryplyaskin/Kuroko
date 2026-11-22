import { Router } from 'express';
import { isConnectionPresetId } from '@kuroko/contracts/connectionSettings';
import { errorBody } from '@kuroko/contracts/errors';
import { isToolId, isToolSelection, type ToolsResponse } from '@kuroko/contracts/tools';
import { readPresetName } from '@kuroko/contracts/presets';
import type { createConnectionStore } from '../connection/connectionStore';
import { createPresetRouter, respondToPresetWrite } from '../http/presetRouter';
import type { createToolsStore } from './toolsStore';

export function createToolsRouter(
  store: ReturnType<typeof createToolsStore>, listConnections: ReturnType<typeof createConnectionStore>['listPresets'],
) {
  const router = Router();
  function read(userId: number): ToolsResponse {
    const settings = store.read(userId);
    const presets = listConnections(userId).map(({ id, name, model, provider }) => ({ id, name, model, provider }));
    if (presets.length) settings.subagent = { presetId: store.subagentPresetId(userId), presets };
    return settings;
  }

  router.get('/', (_request, response) => { response.json(read(response.locals.user.id)); });
  router.put('/subagent', (request, response) => {
    const presetId: unknown = request.body?.presetId;
    if (presetId !== null && !isConnectionPresetId(presetId)) {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const userId: number = response.locals.user.id;
    if (store.selectSubagent(userId, presetId)) response.json(read(userId));
    else response.status(404).json(errorBody('preset_not_found'));
  });
  router.delete('/enabled', (_request, response) => {
    const userId: number = response.locals.user.id;
    store.clear(userId);
    response.json(read(userId));
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
    respondToPresetWrite(response, result, () => read(userId), 201);
  });
  router.put('/presets/:id', (request, response) => {
    const enabled: unknown = request.body?.enabled;
    if (!isToolSelection(enabled)) {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const userId: number = response.locals.user.id;
    respondToPresetWrite(response, store.savePreset(userId, request.params.id, enabled), () => read(userId));
  });
  router.use('/presets', createPresetRouter({ ...store, read }));
  router.put('/:id', (request, response) => {
    const { id } = request.params;
    const enabled: unknown = request.body?.enabled;
    if (!isToolId(id) || typeof enabled !== 'boolean') {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const userId: number = response.locals.user.id;
    store.set(userId, id, enabled);
    response.json(read(userId));
  });
  return router;
}
