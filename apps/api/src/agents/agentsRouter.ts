import { isAgentId, isAgentRevision, readAgent } from '@kuroko/contracts/agents';
import { errorBody } from '@kuroko/contracts/errors';
import { Router, type Response } from 'express';
import { PromptTemplateError, validatePromptTemplate, type createPromptRenderer } from '../instructions/promptTemplate';
import { renderAgentDescription } from './agentDescription';
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

export function createAgentsRouter(
  store: ReturnType<typeof createAgentsStore>, worldExists: (userId: number, id: string) => boolean,
  render: ReturnType<typeof createPromptRenderer>,
) {
  const router = Router();
  const missing = (response: Response) => response.status(404).json(errorBody('agent_not_found'));

  function withDescriptionStatus(userId: number, agent: NonNullable<ReturnType<typeof store.find>>) {
    return renderAgentDescription(render, userId, agent) === undefined ? { ...agent, descriptionIssue: true } : agent;
  }

  router.get('/', (_request, response) => {
    const userId: number = response.locals.user.id;
    response.json(store.list(userId).map((agent) => withDescriptionStatus(userId, agent)));
  });
  router.get('/:id', (request, response) => {
    const { id } = request.params;
    const userId: number = response.locals.user.id;
    const agent = isAgentId(id) ? store.find(userId, id) : undefined;
    if (agent) response.json(withDescriptionStatus(userId, agent));
    else missing(response);
  });
  router.post('/', (request, response) => {
    const userId: number = response.locals.user.id;
    const draft = readDraft(request.body, response, (id) => worldExists(userId, id));
    if (draft) response.status(201).json(withDescriptionStatus(userId, store.create(userId, draft)));
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
    const userId: number = response.locals.user.id;
    const agent = store.save(userId, id, { ...draft, revision });
    if (agent === 'missing') missing(response);
    else if (agent === 'conflict') response.status(409).json(errorBody('agent_conflict'));
    else response.json(withDescriptionStatus(userId, agent));
  });
  router.delete('/:id', (request, response) => {
    const { id } = request.params;
    if (!isAgentId(id)) { missing(response); return; }
    const revision = request.body?.revision;
    if (!isAgentRevision(revision)) {
      response.status(400).json(errorBody('agent_invalid', 'revision'));
      return;
    }
    const result = store.remove(response.locals.user.id, id, revision);
    if (result === 'deleted') response.status(204).end();
    else if (result === 'conflict') response.status(409).json(errorBody('agent_conflict'));
    else missing(response);
  });
  return router;
}
