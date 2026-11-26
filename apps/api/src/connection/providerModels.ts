import type { ApiErrorCode } from '@kuroko/contracts/errors';
import { isModelId, isOpenRouterProvider, type OpenRouterEndpoint, type Provider, type ProviderModel } from '@kuroko/contracts/connectionSettings';
import { LlmError } from '../llm/llmErrors';
import { readProviderFrames } from '../llm/providerResponse';
import type { ProviderConnections } from './providerConnections';

type JsonObject = Record<string, unknown>;
type CatalogResult = { models: ProviderModel[] } | { status: number; code: ApiErrorCode };
type CatalogProvider = {
  path: string;
  readPage: (page: JsonObject) => { items: unknown; cursor?: unknown };
  cursorParam?: string;
  readModel: (item: JsonObject) => ProviderModel | undefined;
};

const catalogUnavailable = { status: 424, code: 'model_catalog_unavailable' } as const;

const dataPage = (page: JsonObject) => ({ items: page.data });
const openAiCatalog: CatalogProvider = {
  path: 'models',
  readPage: dataPage,
  readModel: ({ id }) => isModelId(id) ? { id } : undefined,
};
const catalogProviders: Record<Provider, CatalogProvider> = {
  openai: openAiCatalog,
  custom: openAiCatalog,
  openrouter: {
    path: 'models/user',
    readPage: dataPage,
    readModel: ({ id, context_length, top_provider }) => {
      if (!isModelId(id)) return;
      return { id, contextLimit: tokenLimit(context_length), outputLimit: tokenLimit(asRecord(top_provider)?.max_completion_tokens) };
    },
  },
  anthropic: {
    path: 'models?limit=1000',
    readPage: (page) => ({ items: page.data, cursor: page.has_more ? page.last_id : undefined }),
    cursorParam: 'after_id',
    readModel: ({ id, max_input_tokens, max_tokens }) => {
      if (!isModelId(id)) return;
      return { id, inputLimit: tokenLimit(max_input_tokens), outputLimit: tokenLimit(max_tokens) };
    },
  },
  gemini: {
    path: 'models?pageSize=1000',
    readPage: (page) => ({ items: page.models, cursor: page.nextPageToken }),
    cursorParam: 'pageToken',
    readModel: ({ name, supportedGenerationMethods, inputTokenLimit, outputTokenLimit }) => {
      if (typeof name !== 'string' || !Array.isArray(supportedGenerationMethods) || !supportedGenerationMethods.includes('generateContent')) return;
      const id = name.replace(/^models\//, '');
      if (!isModelId(id)) return;
      return { id, inputLimit: tokenLimit(inputTokenLimit), outputLimit: tokenLimit(outputTokenLimit) };
    },
  },
};

export async function listProviderModels(
  provider: Provider, apiKey: string, connections: ProviderConnections, clientSignal: AbortSignal, baseUrl?: string,
): Promise<CatalogResult> {
  const { path, readPage, cursorParam, readModel } = catalogProviders[provider];
  if (provider === 'custom' && !baseUrl) return catalogUnavailable;
  const connection = provider === 'custom' ? connections.custom(baseUrl!) : connections[provider];
  const headers = new Headers({ Accept: 'application/json', ...connection.headers(apiKey) });
  const url = connection.catalogUrl(path);
  const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(10_000)]);
  const models = new Map<string, ProviderModel>();
  const cursors = new Set<string>();

  try {
    while (true) {
      const response = await connection.fetch(url, { headers, signal });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        if ([400, 401, 403].includes(response.status)) {
          return { status: 422, code: 'model_catalog_rejected' };
        }
        if (response.status === 429) {
          return { status: 429, code: 'model_catalog_rate_limit' };
        }
        return catalogUnavailable;
      }

      const page = await readCatalogJson(response, signal);
      if (!page) return catalogUnavailable;
      const { items, cursor } = readPage(page);
      if (!Array.isArray(items)) return catalogUnavailable;
      for (const item of items) {
        const record = asRecord(item);
        const model = record && readModel(record);
        if (model) models.set(model.id, model);
      }

      if (!cursorParam || typeof cursor !== 'string' || !cursor || cursors.has(cursor)) break;
      cursors.add(cursor);
      url.searchParams.set(cursorParam, cursor);
    }
  } catch (error) {
    if (error instanceof LlmError && error.code === 'custom_api_address_blocked') return { status: error.status, code: error.code };
    return catalogUnavailable;
  }

  return { models: [...models.values()].sort((first, second) => first.id.localeCompare(second.id)) };
}

export async function listOpenRouterEndpoints(
  model: string, apiKey: string, connection: ProviderConnections['openrouter'], clientSignal: AbortSignal,
) {
  const [author, slug, ...rest] = model.split('/');
  if (!author || !isModelId(slug) || rest.length) return;
  const url = connection.catalogUrl(`models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`);
  const headers = { Accept: 'application/json', ...connection.headers(apiKey) };
  const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(10_000)]);
  try {
    const response = await connection.fetch(url, { headers, signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return;
    }
    const page = await readCatalogJson(response, signal);
    const items = asRecord(page?.data)?.endpoints;
    if (!Array.isArray(items)) return;
    const endpoints = new Map<string, OpenRouterEndpoint>();
    for (const item of items) {
      const { tag, provider_name: name } = asRecord(item) ?? {};
      if (!isOpenRouterProvider(tag) || typeof name !== 'string' || !name.trim() || name.length > 128 ||
        tag.includes(apiKey) || name.includes(apiKey)) continue;
      endpoints.set(tag, { tag, name });
    }
    return [...endpoints.values()].sort((a, b) => a.name.localeCompare(b.name) || a.tag.localeCompare(b.tag));
  } catch {
    return;
  }
}

async function readCatalogJson(response: Response, signal: AbortSignal) {
  if (!response.body) return;
  for await (const frame of readProviderFrames(response.body, false, signal)) {
    return asRecord(JSON.parse(frame.data));
  }
}

function asRecord(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null ? value as JsonObject : undefined;
}

function tokenLimit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
