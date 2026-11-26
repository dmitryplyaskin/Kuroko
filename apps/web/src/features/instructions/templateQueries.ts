import { createEffect, createEvent, createStore, sample } from 'effector';
import { defaultRealmFilters, realmPageSize } from '@kuroko/contracts/realms';
import { $activeSession, inActiveSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';
import { abortFx } from '../../shared/async/abort';
import { ApiError, errorCode, type ErrorCode } from '../../shared/http/api';
import { requestRealmList } from '../realms/model';

type Query<Input> = { dialog: string; input: Input };
type Request<Input> = Query<Input> & { session: ActiveSession; controller: AbortController };
type QueryState<Input, Data> = { request: Request<Input> } & (
  { status: 'loading' } | { status: 'ready'; data: Data } | { status: 'error'; code: ErrorCode; field?: string }
);

function createTemplateQuery<Input, Data>(load: (request: Request<Input>) => Promise<Data>) {
  const requested = createEvent<Query<Input>>();
  const closed = createEvent<string>();
  const retried = createEvent<string>();
  const loadFx = createEffect(load);
  const $state = createStore<QueryState<Input, Data> | null>(null)
    .on(loadFx, (_, request) => ({ request, status: 'loading' }))
    .reset(sessionEnded);

  const started = sample({
    clock: requested,
    source: { session: $activeSession, state: $state },
    filter: ({ session }) => session !== null,
    fn: ({ session, state }, query) => ({
      previous: state?.request.controller,
      request: { ...query, session: session!, controller: new AbortController() },
    }),
  });
  sample({ clock: started.filterMap(({ previous }) => previous), target: abortFx });
  sample({ clock: started.map(({ request }) => request), target: loadFx });

  const cancelled = sample({
    clock: closed,
    source: $state,
    filter: (state, dialog) => state?.request.dialog === dialog,
    fn: (state) => state!.request.controller,
  });
  $state.reset(cancelled);
  sample({ clock: cancelled, target: abortFx });

  sample({
    clock: retried,
    source: $state,
    filter: (state, dialog) => state?.status === 'error' && state.request.dialog === dialog,
    fn: (state) => ({ dialog: state!.request.dialog, input: state!.request.input }),
    target: requested,
  });

  $state.on(inActiveSession(loadFx.done, ({ session }) => session), (state, { params, result }) =>
    state?.request === params ? { request: params, status: 'ready', data: result } : state);
  const failed = sample({
    clock: inActiveSession(loadFx.fail, ({ session }) => session),
    source: $state,
    filter: (state, { params }) => state?.request === params,
    fn: (_, failure) => failure,
  });
  $state.on(failed, (_, { params, error }) => ({
    request: params, status: 'error', code: errorCode(error), field: error instanceof ApiError ? error.field : undefined,
  }));
  sample({ clock: failed, fn: ({ params, error }) => ({ session: params.session, error }), target: protectedRequestFailed });

  return { $state, requested, closed, retried };
}

type PreviewInput = { text: string; chatTitle: string; gmMode: boolean; agentName?: string; worldId?: string | null };

export const templatePreview = createTemplateQuery(({ session, controller, input }: Request<PreviewInput>) =>
  sessionRequest<{ text: string }>(session, '/settings/instructions/preview', { method: 'POST', body: input, signal: controller.signal }));

export const templateWorlds = createTemplateQuery(({ session, controller, input }: Request<{ q: string; offset: number }>) =>
  requestRealmList({ session, signal: controller.signal, query: { ...input, limit: realmPageSize, sort: 'updated', filters: defaultRealmFilters } }));
