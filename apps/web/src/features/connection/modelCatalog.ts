import { createEffect, createEvent, createStore, sample } from 'effector';
import { isModelId, readCustomBaseUrl, type Provider } from '@kuroko/contracts/connectionSettings';
import { abortFx } from '../../shared/async/abort';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { inActiveSession, protectedRequestFailed, type ActiveSession } from '../../platform/session/model';
import { connectionApi } from './connectionApi';

type Catalog<Result> = { status: 'idle' | 'loading' } | { status: 'error'; code: ErrorCode } | ({ status: 'ready' } & Result);
type Query = { session: ActiveSession; keyId: string };

function createCatalog<Selection extends Query, Result extends object>(
  fetchCatalog: (selection: Selection, signal: AbortSignal) => Promise<Result>,
  validate: (selection: Selection) => ErrorCode | undefined,
) {
  type Request = Selection & { controller: AbortController };
  const requested = createEvent<Selection>();
  const invalidated = createEvent();
  const loadFx = createEffect((request: Request) => fetchCatalog(request, request.controller.signal));
  const $request = createStore<Request | null>(null).on(loadFx, (_, request) => request);

  const finished = sample({
    clock: inActiveSession(loadFx.finally, ({ session }) => session),
    source: $request,
    filter: (request, { params }) => params === request,
    fn: (_, completion) => completion,
  });
  const reset = sample({ clock: invalidated, source: $request });
  $request.reset(finished, reset);

  const checked = sample({
    clock: requested,
    filter: $request.map((request) => request === null),
    fn: (selection) => ({ selection, code: validate(selection) }),
  });
  const invalid = checked.filterMap(({ code }) => code);
  const $catalog = createStore<Catalog<Result>>({ status: 'idle' })
    .on(loadFx, () => ({ status: 'loading' }))
    .on(finished, (_, result) => result.status === 'done'
      ? { ...result.result, status: 'ready' }
      : { status: 'error', code: errorCode(result.error) })
    .on(invalid, (_, code) => ({ status: 'error', code }))
    .reset(reset);

  sample({
    clock: checked,
    filter: ({ code }) => !code,
    fn: ({ selection }) => ({ ...selection, controller: new AbortController() }),
    target: loadFx,
  });
  sample({ clock: reset.filterMap((request) => request?.controller), target: abortFx });
  sample({
    clock: finished.filterMap((result) => result.status === 'fail'
      ? { session: result.params.session, error: result.error }
      : undefined),
    target: protectedRequestFailed,
  });
  return { requested, invalidated, loadFx, $catalog };
}

export const {
  requested: catalogRequested, invalidated: catalogInvalidated, loadFx: loadModelCatalogFx, $catalog: $modelCatalog,
} = createCatalog(
  ({ session, provider, keyId, baseUrl }: Query & { provider: Provider; baseUrl?: string }, signal) =>
    connectionApi.models(session, provider, keyId, baseUrl, signal),
  ({ provider, keyId, baseUrl }) => {
    if (provider === 'custom') return readCustomBaseUrl(baseUrl) ? undefined : 'custom_api_url_invalid';
    if (!keyId) return 'model_catalog_key_required';
  },
);

export const {
  requested: endpointsRequested, invalidated: endpointsInvalidated, $catalog: $openRouterEndpoints,
} = createCatalog(
  ({ session, model, keyId }: Query & { model: string }, signal) => connectionApi.endpoints(session, model, keyId, signal),
  ({ model, keyId }) => {
    if (!keyId) return 'model_catalog_key_required';
    if (!isModelId(model)) return 'model_id_invalid';
  },
);
