import { isModelId, type Provider, type ProviderModel } from '../../shared/connectionSettings';

const endpoints: Record<Provider, string> = {
  openai: 'https://api.openai.com/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models/user',
  anthropic: 'https://api.anthropic.com/v1/models?limit=1000',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
};

type CatalogResult = { models: ProviderModel[] } | { status: number; error: string };

export async function listProviderModels(provider: Provider, apiKey: string): Promise<CatalogResult> {
  const headers = new Headers({ Accept: 'application/json' });
  if (provider === 'gemini') {
    headers.set('x-goog-api-key', apiKey);
  } else if (provider === 'anthropic') {
    headers.set('x-api-key', apiKey);
    headers.set('anthropic-version', '2023-06-01');
  } else {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }

  const url = new URL(endpoints[provider]);
  const signal = AbortSignal.timeout(10_000);
  const models = new Map<string, ProviderModel>();
  const cursors = new Set<string>();

  try {
    while (true) {
      const response = await fetch(url, { headers, signal, redirect: 'error' });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        if ([400, 401, 403].includes(response.status)) {
          return { status: 422, error: 'Провайдер отклонил запрос. Проверьте API-ключ и его доступ к списку моделей.' };
        }
        if (response.status === 429) {
          return { status: 429, error: 'Провайдер ограничил запросы. Повторите загрузку позже.' };
        }
        throw new Error('Provider request failed');
      }

      const page = asRecord(await response.json());
      const items = provider === 'gemini' ? page?.models : page?.data;
      if (!Array.isArray(items)) throw new Error('Missing model list');
      for (const item of items) {
        const model = readModel(provider, asRecord(item));
        if (model) models.set(model.id, model);
      }

      const cursor = provider === 'gemini' ? page?.nextPageToken :
        provider === 'anthropic' && page?.has_more ? page.last_id : undefined;
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) break;
      cursors.add(cursor);
      url.searchParams.set(provider === 'gemini' ? 'pageToken' : 'after_id', cursor);
    }
  } catch {
    return { status: 424, error: 'Не удалось загрузить модели у провайдера. Повторите загрузку или введите ID модели вручную.' };
  }

  return { models: [...models.values()].sort((first, second) => first.id.localeCompare(second.id)) };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function tokenLimit(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function readModel(provider: Provider, model?: Record<string, unknown>): ProviderModel | undefined {
  if (!model) return undefined;
  if (provider === 'gemini') {
    const methods = model.supportedGenerationMethods;
    if (typeof model.name !== 'string' || !Array.isArray(methods) || !methods.includes('generateContent')) return undefined;
    const id = model.name.replace(/^models\//, '');
    if (!isModelId(id)) return undefined;
    return { id, inputLimit: tokenLimit(model.inputTokenLimit), outputLimit: tokenLimit(model.outputTokenLimit) };
  }

  const { id } = model;
  if (!isModelId(id)) return undefined;
  if (provider === 'anthropic') {
    return { id, inputLimit: tokenLimit(model.max_input_tokens), outputLimit: tokenLimit(model.max_tokens) };
  }
  if (provider === 'openrouter') {
    return { id, contextLimit: tokenLimit(model.context_length), outputLimit: tokenLimit(asRecord(model.top_provider)?.max_completion_tokens) };
  }
  return { id };
}
