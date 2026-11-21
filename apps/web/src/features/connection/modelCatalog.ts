import { createEffect, createEvent, createStore, sample } from 'effector';
import type { Provider, ProviderModel } from '@kuroko/contracts/connectionSettings';
import { abortFx } from '../../shared/async/abort';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { protectedRequestFailed, type ActiveSession } from '../../platform/session/model';
import { inActiveSession } from '../../platform/session/request';
import { connectionApi } from './connectionApi';

type Catalog = { status: 'idle' | 'loading' } | { status: 'error'; code: ErrorCode } | { status: 'ready'; models: ProviderModel[] };
type CatalogQuery = { session: ActiveSession; provider: Provider; keyId: string };
type CatalogRequest = CatalogQuery & { controller: AbortController };

export const catalogRequested = createEvent<CatalogQuery>();
export const catalogInvalidated = createEvent();

export const loadModelCatalogFx = createEffect(({ session, provider, keyId, controller }: CatalogRequest) =>
  connectionApi.models(session, provider, keyId, controller.signal));

const $request = createStore<CatalogRequest | null>(null).on(loadModelCatalogFx, (_, request) => request);

const catalogFinished = sample({
  clock: inActiveSession(loadModelCatalogFx.finally, ({ session }) => session),
  source: $request,
  filter: (request, { params }) => params === request,
  fn: (_, completion) => completion,
});
const catalogReset = sample({ clock: catalogInvalidated, source: $request });
$request.reset(catalogFinished, catalogReset);

const catalogMissingKey = sample({
  clock: catalogRequested,
  filter: ({ keyId }) => !keyId,
});

export const $modelCatalog = createStore<Catalog>({ status: 'idle' })
  .on(loadModelCatalogFx, () => ({ status: 'loading' }))
  .on(catalogFinished, (_, result) => result.status === 'done'
    ? { status: 'ready', models: result.result.models }
    : { status: 'error', code: errorCode(result.error) })
  .on(catalogMissingKey, () => ({
    status: 'error', code: 'model_catalog_key_required',
  }))
  .reset(catalogReset);

sample({
  clock: catalogRequested,
  source: $request,
  filter: (request, { keyId }) => request === null && Boolean(keyId),
  fn: (_, query) => ({ ...query, controller: new AbortController() }),
  target: loadModelCatalogFx,
});
sample({
  clock: catalogReset,
  filter: (request): request is CatalogRequest => request !== null,
  fn: (request) => request!.controller,
  target: abortFx,
});
const catalogFailed = catalogFinished.filterMap((result) => result.status === 'fail'
  ? { session: result.params.session, error: result.error }
  : undefined);
sample({ clock: catalogFailed, target: protectedRequestFailed });
