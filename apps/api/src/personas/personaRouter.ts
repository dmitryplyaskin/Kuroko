import { readAvatar } from '@kuroko/contracts/avatar';
import { errorBody } from '@kuroko/contracts/errors';
import { isPersonaId, personaPageSize, personaSearchLimit, personaSorts, personaVariableFilters, readPersona,
  type PersonaListQuery, type PersonaSelection } from '@kuroko/contracts/personas';
import { isPresetRevision } from '@kuroko/contracts/presets';
import { Router, type Response } from 'express';
import type { createPersonaStore } from './personaStore';

function readQuery({
  q = '', sort = 'updated', offset = '0', favorites = '0', variables = 'any',
}: Record<string, unknown>): PersonaListQuery | undefined {
  const order = personaSorts.find((value) => value === sort);
  const filter = personaVariableFilters.find((value) => value === variables);
  if (typeof q !== 'string' || q.length > personaSearchLimit || !q.isWellFormed() || !order || !filter ||
    (favorites !== '0' && favorites !== '1') || typeof offset !== 'string' || !/^\d+$/.test(offset)) return;
  const first = Number(offset);
  if (!Number.isSafeInteger(first) || first % personaPageSize !== 0) return;
  return { q: q.trim(), sort: order, variables: filter, favorites: favorites === '1', offset: first };
}

export function createPersonaRouter(store: ReturnType<typeof createPersonaStore>) {
  const router = Router();
  const missing = (response: Response) => response.status(404).json(errorBody('persona_not_found'));
  const invalid = (response: Response, field: string) => response.status(400).json(errorBody('persona_invalid', field));
  const conflict = (response: Response) => response.status(409).json(errorBody('persona_conflict'));

  router.get('/', (request, response) => {
    const query = readQuery(request.query);
    if (query) response.json(store.list(response.locals.user.id, query));
    else response.status(400).json(errorBody('invalid_request'));
  });

  router.post('/', (request, response) => {
    const id = request.body?.id;
    if (!isPersonaId(id)) { invalid(response, '/id'); return; }
    const result = readPersona(request.body);
    if ('field' in result) { invalid(response, result.field); return; }
    const saved = store.create(response.locals.user.id, id, result.draft);
    if (saved === 'conflict') conflict(response);
    else response.location(`/api/personas/${id}`).status(saved.created ? 201 : 200).json(saved.persona);
  });

  router.get('/active', (_request, response) => {
    response.json({ id: store.activeId(response.locals.user.id) } satisfies PersonaSelection);
  });

  router.put('/active', (request, response) => {
    const id = request.body?.id;
    if (id !== null && !isPersonaId(id)) { invalid(response, '/id'); return; }
    if (!store.select(response.locals.user.id, id)) { missing(response); return; }
    response.json({ id } satisfies PersonaSelection);
  });

  router.get('/:id/avatar', (request, response) => {
    const { id } = request.params;
    const image = isPersonaId(id) && readAvatar(store.avatar(response.locals.user.id, id));
    if (image) response.type(image.mime).send(Buffer.from(image.data, 'base64'));
    else missing(response);
  });

  router.get('/:id', (request, response) => {
    const { id } = request.params;
    const persona = isPersonaId(id) && store.find(response.locals.user.id, id);
    if (persona) response.json(persona);
    else missing(response);
  });

  router.put('/:id', (request, response) => {
    const { id } = request.params;
    if (!isPersonaId(id)) { missing(response); return; }
    const revision = request.body?.revision;
    if (!isPresetRevision(revision)) { invalid(response, '/revision'); return; }
    const result = readPersona(request.body);
    if ('field' in result) { invalid(response, result.field); return; }
    const persona = store.save(response.locals.user.id, id, revision, result.draft);
    if (persona === 'missing') missing(response);
    else if (persona === 'conflict') conflict(response);
    else response.json(persona);
  });

  router.put('/:id/favorite', (request, response) => {
    const { id } = request.params;
    const favorite = request.body?.favorite;
    if (!isPersonaId(id)) { missing(response); return; }
    if (typeof favorite !== 'boolean') { invalid(response, '/favorite'); return; }
    if (store.setFavorite(response.locals.user.id, id, favorite)) response.json({ favorite });
    else missing(response);
  });

  router.delete('/:id', (request, response) => {
    const { id } = request.params;
    if (!isPersonaId(id)) { missing(response); return; }
    const revision = request.body?.revision;
    if (!isPresetRevision(revision)) { invalid(response, '/revision'); return; }
    const result = store.remove(response.locals.user.id, id, revision);
    if (result === 'deleted') response.status(204).end();
    else if (result === 'conflict') conflict(response);
    else missing(response);
  });
  return router;
}
