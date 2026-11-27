import { errorBody } from '@kuroko/contracts/errors';
import { isPersonaId, type SavedPersona } from '@kuroko/contracts/personas';
import { resolveRealmContext } from '@kuroko/contracts/realmContext';
import { readRealm, readRealmAvatar, realmPageSize, realmSearchMaxLength, realmSorts, realmStartsFilters,
  type RealmListQuery } from '@kuroko/contracts/realms';
import { Router } from 'express';
import type { createRealmStore } from './realmStore';

export function createRealmRouter(store: ReturnType<typeof createRealmStore>, findPersona: (userId: number, id: string) => SavedPersona | undefined) {
  const router = Router();

  router.get('/', (request, response) => {
    const query = readListQuery(request.query);
    if (query) response.json(store.list(response.locals.user.id, query));
    else response.status(400).json(errorBody('invalid_request'));
  });

  router.get('/filters', (_request, response) => {
    response.json(store.filters(response.locals.user.id));
  });

  router.post('/', (request, response) => {
    const document = readRealm(request.body);
    if ('code' in document) {
      response.status(400).json(errorBody(document.code, document.field));
      return;
    }
    const result = store.create(response.locals.user.id, document.realm);
    if (result === 'duplicate') response.status(409).json(errorBody('realm_id_taken', '/id'));
    else response.location(`/api/realms/${result.saved.id}`).status(result.created ? 201 : 200).json(result.saved);
  });

  router.get('/:id/avatar', (request, response) => {
    const image = readRealmAvatar(store.avatar(response.locals.user.id, request.params.id));
    if (image) response.type(image.mime).send(Buffer.from(image.data, 'base64'));
    else response.status(404).json(errorBody('realm_not_found'));
  });

  router.get('/:id/context', (request, response) => {
    const { start: startId, persona: personaId } = request.query;
    if (startId !== undefined && (typeof startId !== 'string' || !startId)) {
      response.status(400).json(errorBody('invalid_request', 'start'));
      return;
    }
    if (personaId !== undefined && !isPersonaId(personaId)) {
      response.status(400).json(errorBody('invalid_request', 'persona'));
      return;
    }
    const userId: number = response.locals.user.id;
    const saved = store.find(userId, request.params.id);
    if (!saved) {
      response.status(404).json(errorBody('realm_not_found'));
      return;
    }
    const start = saved.realm.starts?.find(({ id }) => id === startId);
    if (startId !== undefined && !start) {
      response.status(404).json(errorBody('realm_start_not_found'));
      return;
    }
    const persona = personaId === undefined ? undefined : findPersona(userId, personaId);
    if (personaId !== undefined && !persona) {
      response.status(404).json(errorBody('persona_not_found'));
      return;
    }
    response.json(resolveRealmContext(saved.realm, start, persona));
  });

  router.get('/:id', (request, response) => {
    const realm = store.find(response.locals.user.id, request.params.id);
    if (realm) response.json(realm);
    else response.status(404).json(errorBody('realm_not_found'));
  });

  router.put('/:id', (request, response) => {
    const { revision, realm } = request.body ?? {};
    if (!isRevision(revision)) {
      response.status(400).json(errorBody('invalid_request', 'revision'));
      return;
    }
    const document = readRealm(realm);
    if ('code' in document) {
      response.status(400).json(errorBody(document.code, document.field));
      return;
    }
    const result = store.save(response.locals.user.id, request.params.id, { revision, realm: document.realm });
    if (result === 'missing') response.status(404).json(errorBody('realm_not_found'));
    else if (result === 'conflict') response.status(409).json(errorBody('realm_conflict'));
    else if (result === 'identity') response.status(400).json(errorBody('realm_invalid', '/id'));
    else response.json(result);
  });

  router.put('/:id/favorite', (request, response) => {
    const { favorite } = request.body ?? {};
    if (typeof favorite !== 'boolean') {
      response.status(400).json(errorBody('invalid_request', 'favorite'));
      return;
    }
    const result = store.setFavorite(response.locals.user.id, request.params.id, favorite);
    if (result) response.json(result);
    else response.status(404).json(errorBody('realm_not_found'));
  });

  router.delete('/:id', (request, response) => {
    const raw = request.query.revision;
    const revision = readInteger(raw);
    if (raw !== undefined && revision === undefined) {
      response.status(400).json(errorBody('invalid_request', 'revision'));
      return;
    }
    const result = store.delete(response.locals.user.id, request.params.id, revision);
    if (result === 'missing') response.status(404).json(errorBody('realm_not_found'));
    else if (result === 'conflict') response.status(409).json(errorBody('realm_conflict'));
    else response.status(204).end();
  });

  return router;
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readInteger(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return;
  const number = Number(value);
  if (isRevision(number)) return number;
}

function readListQuery({
  q = '', sort = 'updated', limit = String(realmPageSize), offset = '0', author = '', tag = [], starts = 'any', favorites = '0',
}: Record<string, unknown>): RealmListQuery | undefined {
  if (typeof q !== 'string' || q.length > realmSearchMaxLength) return;
  const order = realmSorts.find((option) => option === sort);
  const size = readInteger(limit);
  const first = readInteger(offset);
  if (order === undefined || size === undefined || size < 1 || size > 100 || first === undefined) return;
  const tags = typeof tag === 'string' ? [tag] : tag;
  const startFilter = realmStartsFilters.find((option) => option === starts);
  if (typeof author !== 'string' || !Array.isArray(tags) || !tags.every((value) => typeof value === 'string' && value.trim()) ||
      !startFilter || (favorites !== '0' && favorites !== '1')) return;
  return { q: q.trim(), sort: order, limit: size, offset: first, filters: { author, tags, starts: startFilter, favorites: favorites === '1' } };
}
