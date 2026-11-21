import type { Provider } from '@kuroko/contracts/connectionSettings';

const bearer = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` });
const defaults = {
  openai: { base: 'https://api.openai.com/v1/', generation: 'chat/completions', headers: bearer },
  openrouter: { base: 'https://openrouter.ai/api/v1/', generation: 'chat/completions', headers: bearer },
  anthropic: {
    base: 'https://api.anthropic.com/v1/', generation: 'messages',
    headers: (apiKey: string) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
  },
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta/', generation: 'models/{model}:{method}',
    headers: (apiKey: string) => ({ 'x-goog-api-key': apiKey }),
  },
} satisfies Record<Provider, { base: string; generation: string; headers: (apiKey: string) => Record<string, string> }>;

export function createProviderConnections(env = process.env) {
  function connection(provider: Provider) {
    const { base, generation, headers } = defaults[provider];
    const prefix = provider.toUpperCase();
    const baseUrl = new URL(env[`${prefix}_BASE_URL`] || base);
    if (!['https:', 'http:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new Error(`Invalid ${prefix}_BASE_URL`);
    }
    if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

    const generationPath = env[`${prefix}_GENERATION_PATH`] || generation;
    const literalPath = generationPath.replace('{model}', 'model').replace('{method}', 'method');
    if (!/^[\w:.-]+(?:\/[\w:.-]+)*$/.test(literalPath) || literalPath.split('/').some((part) => part === '.' || part === '..')) {
      throw new Error(`Invalid ${prefix}_GENERATION_PATH`);
    }

    return {
      headers,
      catalogUrl: (path: string) => new URL(path, baseUrl),
      generationUrl: (model: string, stream: boolean) => {
        const method = stream ? 'streamGenerateContent' : 'generateContent';
        const path = generationPath.replace('{model}', encodeURIComponent(model)).replace('{method}', method);
        const url = new URL(`./${path}`, baseUrl);
        if (provider === 'gemini' && stream) url.searchParams.set('alt', 'sse');
        return url;
      },
    };
  }

  return {
    openai: connection('openai'),
    openrouter: connection('openrouter'),
    anthropic: connection('anthropic'),
    gemini: connection('gemini'),
  };
}

export type ProviderConnections = ReturnType<typeof createProviderConnections>;
