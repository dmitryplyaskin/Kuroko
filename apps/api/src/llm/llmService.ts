import { isApiKey } from '@kuroko/contracts/connectionSettings';
import type { LlmCompletion, LlmEvent, LlmRequest } from '@kuroko/contracts/llm';
import type { createConnectionStore } from '../connection/connectionStore';
import type { ProviderConnections } from '../connection/providerConnections';
import type { ProviderKeyStore } from '../connection/providerKeyStore';
import { LlmError, upstreamError } from './llmErrors';
import { providerAdapters } from './providerAdapters';
import { ProviderOutput, readProviderFrames } from './providerResponse';
import { validateParameterOverrides } from './readLlmRequest';

type StreamOutput = {
  start: () => void;
  emit: (event: Extract<LlmEvent, { type: 'text_delta' | 'tool_call' }>, signal: AbortSignal) => Promise<void>;
};

export function createLlmService(
  presets: ReturnType<typeof createConnectionStore>, keys: ProviderKeyStore, connections: ProviderConnections,
) {
  return {
    async generate(userId: number, request: LlmRequest, clientSignal: AbortSignal, downstream?: StreamOutput): Promise<LlmCompletion> {
      const preset = presets.find(userId, request.presetId);
      if (!preset) throw new LlmError('missing_preset');
      const { id, provider } = preset;
      validateParameterOverrides(provider, request.parameters);
      const apiKey = preset.keyId ? keys.getForProvider(userId, provider, preset.keyId)?.trim() : undefined;
      if (!isApiKey(apiKey)) throw new LlmError('missing_key');

      const adapter = providerAdapters[provider];
      const connection = connections[provider];
      const model = provider === 'gemini' ? preset.model.replace(/^models\//, '') : preset.model;
      if (provider === 'gemini' && !/^[a-z\d][a-z\d._-]*$/i.test(model)) throw new LlmError('invalid_request');
      const stream = request.stream ?? false;
      const settings = { ...preset, ...request.parameters, model };
      const body = JSON.stringify(adapter.request({
        settings, messages: request.messages, tools: request.tools ?? [], toolChoice: request.toolChoice, stream,
      }));
      const url = connection.generationUrl(model, stream);
      const timeout = AbortSignal.timeout(120_000);
      const signal = AbortSignal.any([clientSignal, timeout]);
      const output = new ProviderOutput();

      try {
        const upstream = await fetch(url, {
          method: 'POST',
          headers: {
            Accept: stream ? 'text/event-stream' : 'application/json',
            'Content-Type': 'application/json',
            ...connection.headers(apiKey),
          },
          body, signal, redirect: 'error',
        });
        if (!upstream.ok) {
          void upstream.body?.cancel().catch(() => undefined);
          throw upstreamError(upstream.status);
        }

        const mediaType = upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        const validMedia = stream ? mediaType === 'text/event-stream'
          : mediaType === 'application/json' || mediaType?.endsWith('+json');
        if (!upstream.body || !validMedia) {
          void upstream.body?.cancel().catch(() => undefined);
          throw new LlmError('provider_protocol');
        }
        const frames = readProviderFrames(upstream.body, stream, signal);
        downstream?.start();
        for await (const text of adapter.read(frames, output, stream)) {
          if (downstream) await downstream.emit({ type: 'text_delta', text }, signal);
        }
      } catch (error) {
        if (clientSignal.aborted) throw clientSignal.reason;
        if (timeout.aborted) throw new LlmError('timeout');
        if (error instanceof LlmError) throw error;
        throw new LlmError('provider_unavailable');
      }
      const completion = complete(output, id, provider, preset.model, settings.contextTokens);
      if (downstream) {
        for (const part of completion.message.parts) {
          if (part.type === 'toolCall') await downstream.emit({ type: 'tool_call', call: part }, clientSignal);
        }
      }
      return completion;
    },
  };
}

function complete(output: ProviderOutput, presetId: string, provider: LlmCompletion['provider'], model: string, contextTokens: number | null): LlmCompletion {
  const finish = output.finish;
  if (!finish) throw new LlmError('provider_protocol');
  const canUseTools = finish.reason !== 'length' && finish.reason !== 'content_filter';
  const parts = canUseTools ? output.parts : output.parts.filter((part) => part.type !== 'toolCall');
  const calls = parts.filter((part) => part.type === 'toolCall');
  if ((finish.reason === 'tool_calls' && !calls.length) || new Set(calls.map(({ id }) => id)).size !== calls.length) {
    throw new LlmError('provider_protocol');
  }
  const { usage } = output;
  if (usage && usage.totalTokens === undefined && usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
  }
  return {
    presetId, provider, model,
    message: { role: 'assistant', parts, openrouterReasoning: output.openrouterReasoning },
    finishReason: calls.length && finish.reason === 'stop' ? 'tool_calls' : finish.reason,
    providerFinishReason: finish.raw,
    usage, contextTokens,
    contextLimitExceeded: contextTokens !== null && usage?.inputTokens !== undefined
      ? usage.inputTokens > contextTokens : undefined,
  };
}
