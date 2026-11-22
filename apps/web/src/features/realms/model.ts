import type { Realm, RealmFavorite, RealmFilterOptions, RealmList, RealmListQuery, SavedRealm } from '@kuroko/contracts/realms';
import { createEffect, createStore, sample, type Effect } from 'effector';
import { protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { inActiveSession, sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';

type Request = { session: ActiveSession; signal: AbortSignal };
type ListRequest = Request & { query: RealmListQuery };
type QueryState<Params, Data> = { params: Params } & (
  { status: 'loading'; data?: Data } | { status: 'ready'; data: Data } | { status: 'error'; code: ErrorCode }
);

export function newRealmId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function realmEffect<P extends { session: ActiveSession }, Data>(request: (params: P) => Promise<Data>) {
  const effect = createEffect(request);
  sample({
    clock: inActiveSession(effect.fail, ({ session }) => session),
    fn: ({ params, error }) => ({ session: params.session, error }),
    target: protectedRequestFailed,
  });
  return effect;
}

function trackQuery<P extends ListRequest, Data>(effect: Effect<P, Data, Error>) {
  return createStore<QueryState<P, Data> | null>(null)
    .on(effect, (current, params) => ({
      params, status: 'loading', data: current?.params.session === params.session && current.params.query === params.query &&
        current.status !== 'error' ? current.data : undefined,
    }))
    .on(inActiveSession(effect.done, ({ session }) => session), (current, { params, result }) => {
      if (current?.params === params && !params.signal.aborted) return { params, status: 'ready', data: result };
      return current;
    })
    .on(inActiveSession(effect.fail, ({ session }) => session), (current, { params, error }) => {
      if (current?.params === params && !params.signal.aborted) return { params, status: 'error', code: errorCode(error) };
      return current;
    })
    .reset(sessionEnded);
}

export const listRealmsFx = realmEffect(({ session, signal, query }: ListRequest) => {
  const params = new URLSearchParams({ q: query.q, sort: query.sort, limit: String(query.limit), offset: String(query.offset) });
  const { author, tags, starts, favorites } = query.filters;
  if (author) params.set('author', author);
  for (const tag of tags) params.append('tag', tag);
  if (starts !== 'any') params.set('starts', starts);
  if (favorites) params.set('favorites', '1');
  return sessionRequest<RealmList>(session, `/realms?${params}`, { signal });
});

const realmPath = (id: string) => `/realms/${encodeURIComponent(id)}`;

export const loadRealmFiltersFx = realmEffect(({ session, signal }: Request) =>
  sessionRequest<RealmFilterOptions>(session, '/realms/filters', { signal }));

export const setRealmFavoriteFx = realmEffect(({ session, id, favorite }: RealmFavorite & { session: ActiveSession }) =>
  sessionRequest<RealmFavorite>(session, `${realmPath(id)}/favorite`, { method: 'PUT', body: { favorite } }));

export const loadRealmFx = realmEffect(({ session, signal, id }: Request & { id: string }) =>
  sessionRequest<SavedRealm>(session, realmPath(id), { signal }));

export const saveRealmFx = realmEffect(({ session, realm, saved }: { session: ActiveSession; realm: Realm; saved?: SavedRealm }) =>
  saved ? sessionRequest<SavedRealm>(session, realmPath(saved.id), { method: 'PUT', body: { revision: saved.revision, realm } })
    : sessionRequest<SavedRealm>(session, '/realms', { method: 'POST', body: realm }));

export const deleteRealmFx = realmEffect(({ session, id, revision }: { session: ActiveSession; id: string; revision: number }) =>
  sessionRequest<void>(session, `${realmPath(id)}?revision=${revision}`, { method: 'DELETE' }));

const favoriteChanged = inActiveSession(setRealmFavoriteFx.done, ({ session }) => session);
export const $realmList = trackQuery(listRealmsFx).on(favoriteChanged, (current, { params, result }) => {
  if (!current || current.params.session !== params.session || current.status === 'error' || !current.data ||
      current.params.query.filters.favorites) return current;
  const { data } = current;
  return {
    ...current, data: { ...data, items: data.items.map((item) => item.id === result.id
      ? { ...item, favorite: result.favorite ? true : undefined } : item) },
  };
});

sample({
  clock: favoriteChanged,
  source: $realmList,
  filter: (current, { params }) => Boolean(current && current.params.session === params.session && !current.params.signal.aborted &&
    (current.params.query.filters.favorites || current.status !== 'ready')),
  fn: (current) => ({ ...current!.params }),
  target: listRealmsFx,
});
