import { Router } from 'express';
import { errorBody } from '@kuroko/contracts/errors';
import { isToolId, type ToolsResponse } from '@kuroko/contracts/tools';
import type { createToolsStore } from './toolsStore';

export function createToolsRouter(store: ReturnType<typeof createToolsStore>) {
  const read = (userId: number): ToolsResponse => ({ enabled: store.list(userId) });

  const router = Router();
  router.get('/', (_request, response) => { response.json(read(response.locals.user.id)); });
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
