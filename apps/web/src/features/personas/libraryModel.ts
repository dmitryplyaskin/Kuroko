import { defaultPersonaQuery, type PersonaFavorite, type PersonaList, type PersonaListQuery } from '@kuroko/contracts/personas';
import { createEvent, createStore, sample } from 'effector';
import { $activeSession, inActiveSession, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { personaWritten } from './editorModel';
import { personaEffect, personaPath, personasPath } from './requests';

export const personaCriteriaChanged = createEvent<Partial<PersonaListQuery>>();
export const personaPageChanged = createEvent<number>();
export const $personaCriteria = createStore<PersonaListQuery>(defaultPersonaQuery)
  .on(personaCriteriaChanged, (criteria, change) => ({ ...criteria, ...change, offset: 0 }))
  .on(personaPageChanged, (criteria, offset) => ({ ...criteria, offset }))
  .reset(sessionEnded);

type ListRequest = { session: ActiveSession; signal: AbortSignal; query: PersonaListQuery };
type LibraryState = { request: ListRequest } & (
  { status: 'loading'; data?: PersonaList } | { status: 'ready'; data: PersonaList } | { status: 'error'; error: ErrorCode }
);
export const listPersonasFx = personaEffect(({ session, signal, query }: ListRequest) => {
  const params = new URLSearchParams({
    q: query.q.trim(), sort: query.sort, variables: query.variables, favorites: query.favorites ? '1' : '0', offset: String(query.offset),
  });
  return sessionRequest<PersonaList>(session, `${personasPath}?${params}`, { signal });
});
const loaded = inActiveSession(listPersonasFx.done, ({ session }) => session);
const loadFailed = inActiveSession(listPersonasFx.fail, ({ session }) => session);

export const personaFavoriteChanged = createEvent<PersonaFavorite & { id: string }>();
const favoriteFx = personaEffect(({ session, id, favorite }: PersonaFavorite & { session: ActiveSession; id: string }) =>
  sessionRequest<PersonaFavorite>(session, `${personaPath(id)}/favorite`, { method: 'PUT', body: { favorite } }));
const favorited = inActiveSession(favoriteFx.done, ({ session }) => session);
const favoriteFailed = inActiveSession(favoriteFx.fail, ({ session }) => session);

export const $personaFavorite = createStore<{ pendingId?: string; error?: ErrorCode }>({})
  .on(favoriteFx, (_, { id }) => ({ pendingId: id }))
  .on(favorited, () => ({}))
  .on(favoriteFailed, (_, { error }) => ({ error: errorCode(error) }))
  .on([personaCriteriaChanged, personaPageChanged], ({ pendingId }) => ({ pendingId }))
  .reset(sessionEnded);

export const $personaList = createStore<LibraryState | null>(null)
  .on(listPersonasFx, (current, request) => ({
    request, status: 'loading',
    data: current?.request.query === request.query && current.status !== 'error' ? current.data : undefined,
  }))
  .on(loaded, (current, { params, result }) =>
    current?.request === params && !params.signal.aborted ? { request: params, status: 'ready', data: result } : current)
  .on(loadFailed, (current, { params, error }) =>
    current?.request === params && !params.signal.aborted ? { request: params, status: 'error', error: errorCode(error) } : current)
  .reset(sessionEnded, personaWritten);

sample({
  clock: personaFavoriteChanged,
  source: { session: $activeSession, favorite: $personaFavorite },
  filter: ({ session, favorite }) => session !== null && favorite.pendingId === undefined,
  fn: ({ session }, change) => ({ session: session!, ...change }),
  target: favoriteFx,
});
sample({
  clock: [favorited, favoriteFailed.filterMap((failure) => errorCode(failure.error) === 'persona_not_found' ? failure : undefined)],
  source: $personaList,
  filter: (current, { params }) => current?.request.session === params.session && !current.request.signal.aborted,
  fn: (current) => ({ ...current!.request }),
  target: listPersonasFx,
});
