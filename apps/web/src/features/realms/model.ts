import type { Realm, RealmList, RealmListQuery, SavedRealm } from '@kuroko/contracts/realms';
import { createEffect, createStore, sample, type Effect } from 'effector';
import { protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { inActiveSession, sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';

type Request = { session: ActiveSession; signal: AbortSignal };
type QueryState<Params, Data> = { params: Params } & (
  { status: 'loading' } | { status: 'ready'; data: Data } | { status: 'error'; code: ErrorCode }
);

function realmEffect<P extends { session: ActiveSession }, Data>(request: (params: P) => Promise<Data>) {
  const effect = createEffect(request);
  sample({
    clock: inActiveSession(effect.fail, ({ session }) => session),
    fn: ({ params, error }) => ({ session: params.session, error }),
    target: protectedRequestFailed,
  });
  return effect;
}

function trackQuery<P extends Request, Data>(effect: Effect<P, Data, Error>) {
  return createStore<QueryState<P, Data> | null>(null)
    .on(effect, (_, params) => ({ params, status: 'loading' }))
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

export const listRealmsFx = realmEffect(({ session, signal, query }: Request & { query: RealmListQuery }) => {
  const params = new URLSearchParams({ q: query.q, sort: query.sort, limit: String(query.limit), offset: String(query.offset) });
  return sessionRequest<RealmList>(session, `/realms?${params}`, { signal });
});

const realmPath = (id: string) => `/realms/${encodeURIComponent(id)}`;

export const loadRealmFx = realmEffect(({ session, signal, id }: Request & { id: string }) =>
  sessionRequest<SavedRealm>(session, realmPath(id), { signal }));

export const saveRealmFx = realmEffect(({ session, realm, saved }: { session: ActiveSession; realm: Realm; saved?: SavedRealm }) =>
  saved ? sessionRequest<SavedRealm>(session, realmPath(saved.id), { method: 'PUT', body: { revision: saved.revision, realm } })
    : sessionRequest<SavedRealm>(session, '/realms', { method: 'POST', body: realm }));

export const deleteRealmFx = realmEffect(({ session, id, revision }: { session: ActiveSession; id: string; revision: number }) =>
  sessionRequest<void>(session, `${realmPath(id)}?revision=${revision}`, { method: 'DELETE' }));

export const $realmList = trackQuery(listRealmsFx);
