import { isAgentId, isAgentRevision, readAgent } from '@kuroko/contracts/agents';
import { errorBody } from '@kuroko/contracts/errors';
import { Router, type Response } from 'express';
import { PromptTemplateError, validatePromptTemplate } from '../instructions/promptTemplate';
import type { createAgentsStore } from './agentsStore';

function readDraft(body: unknown, response: Response, worldExists: (id: string) => boolean) {
  const result = readAgent(body);
  if ('field' in result) {
    response.status(400).json(errorBody('agent_invalid', result.field));
    return;
  }
  if (result.draft.worldId && !worldExists(result.draft.worldId)) {
    response.status(404).json(errorBody('realm_not_found'));
    return;
  }
  try {
    validatePromptTemplate(result.draft.instructions);
    validatePromptTemplate(result.draft.description);
    return result.draft;
  } catch (error) {
    if (!(error instanceof PromptTemplateError)) throw error;
    response.status(422).json(error.body);
  }
}

export function createAgentsRouter(store: ReturnType<typeof createAgentsStore>, worldExists: (userId: number, id: string) => boolean) {
  const router = Router();
  const missing = (response: Response) => response.status(404).json(errorBody('agent_not_found'));

  router.get('/', (_request, response) => { response.json(store.list(response.locals.user.id)); });
  router.get('/:id', (request, response) => {
    const { id } = request.params;
    const agent = isAgentId(id) ? store.find(response.locals.user.id, id) : undefined;
    if (agent) response.json(agent);
    else missing(response);
  });
  router.post('/', (request, response) => {
    const draft = readDraft(request.body, response, (id) => worldExists(response.locals.user.id, id));
    if (draft) response.status(201).json(store.create(response.locals.user.id, draft));
  });
  router.put('/:id', (request, response) => {
    const { id } = request.params;
    if (!isAgentId(id)) { missing(response); return; }
    const draft = readDraft(request.body, response, (worldId) => worldExists(response.locals.user.id, worldId));
    if (!draft) return;
    const revision = request.body?.revision;
    if (!isAgentRevision(revision)) {
      response.status(400).json(errorBody('agent_invalid', 'revision'));
      return;
    }
    const agent = store.save(response.locals.user.id, id, { ...draft, revision });
    if (agent === 'missing') missing(response);
    else if (agent === 'conflict') response.status(409).json(errorBody('agent_conflict'));
    else response.json(agent);
  });
  router.delete('/:id', (request, response) => {
    const { id } = request.params;
    if (isAgentId(id) && store.remove(response.locals.user.id, id)) response.sendStatus(204);
    else missing(response);
  });
  return router;
}
