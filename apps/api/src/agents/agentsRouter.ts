import { isAgentId, readAgent } from '@kuroko/contracts/agents';
import { errorBody } from '@kuroko/contracts/errors';
import { Router, type Response } from 'express';
import type { createAgentsStore } from './agentsStore';

export function createAgentsRouter(store: ReturnType<typeof createAgentsStore>) {
  const router = Router();
  const missing = (response: Response) => response.status(404).json(errorBody('agent_not_found'));

  router.get('/', (_request, response) => { response.json(store.list(response.locals.user.id)); });
  router.post('/', (request, response) => {
    const result = readAgent(request.body);
    if ('field' in result) {
      response.status(400).json(errorBody('agent_invalid', result.field));
      return;
    }
    response.status(201).json(store.create(response.locals.user.id, result.draft));
  });
  router.put('/:id', (request, response) => {
    const { id } = request.params;
    if (!isAgentId(id)) { missing(response); return; }
    const result = readAgent(request.body);
    if ('field' in result) {
      response.status(400).json(errorBody('agent_invalid', result.field));
      return;
    }
    const agent = store.save(response.locals.user.id, id, result.draft);
    if (agent) response.json(agent);
    else missing(response);
  });
  router.delete('/:id', (request, response) => {
    const { id } = request.params;
    if (isAgentId(id) && store.remove(response.locals.user.id, id)) response.sendStatus(204);
    else missing(response);
  });
  return router;
}
