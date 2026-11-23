import type { ConnectionSettings } from '@kuroko/contracts/connectionSettings';
import type { JsonObject, JsonValue, LlmFinishReason, LlmMessage, LlmTextDelta, LlmTool, LlmToolCall, LlmToolChoice } from '@kuroko/contracts/llm';
import { jsonObject, list, parseObject, record } from './json';
import { LlmError, upstreamError } from './llmErrors';
import { providerObject, tokenCount, type ProviderFrame, type ProviderOutput } from './providerResponse';
import { isToolCallId, isToolName, readAnthropicThinking } from './readLlmRequest';

export type GenerationInput = {
  settings: ConnectionSettings;
  messages: LlmMessage[];
  tools: LlmTool[];
  toolChoice?: LlmToolChoice;
  stream: boolean;
  includeReasoning?: boolean;
};

type Adapter = {
  request: (input: GenerationInput) => object;
  read: (frames: AsyncIterable<ProviderFrame>, output: ProviderOutput, stream: boolean) => AsyncIterable<LlmTextDelta>;
};

function invalidResponse(): never {
  throw new LlmError('provider_protocol');
}

function readCall(id: unknown, name: unknown, args: unknown): Omit<LlmToolCall, 'type'> {
  if (!isToolCallId(id) || !isToolName(name) || !jsonObject(args)) invalidResponse();
  return { id, name, arguments: args };
}

function toolText(content: JsonValue, isError?: boolean) {
  if (isError) return JSON.stringify({ error: content });
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function chatRequest({ settings, messages, tools, toolChoice, stream }: GenerationInput, provider: 'openai' | 'openrouter' | 'custom' = 'openai') {
  const openrouter = provider === 'openrouter';
  const custom = provider === 'custom';
  return {
    model: settings.model,
    messages: messages.map((message) => {
      switch (message.role) {
        case 'assistant': {
          const content = message.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('');
          const calls = message.parts.flatMap((part) => part.type === 'toolCall' ? [{
            id: part.id, type: 'function',
            function: { name: part.name, arguments: JSON.stringify(part.arguments) },
          }] : []);
          return {
            role: message.role, content: content || (calls.length ? null : ''), tool_calls: calls.length ? calls : undefined,
            reasoning_details: openrouter ? message.openrouterReasoning : undefined,
          };
        }
        case 'tool': return { role: message.role, tool_call_id: message.callId, content: toolText(message.content, message.isError) };
        default: return message;
      }
    }),
    stream,
    stream_options: stream && !custom ? { include_usage: true } : undefined,
    max_completion_tokens: custom ? undefined : settings.responseTokens ?? undefined,
    max_tokens: custom ? settings.responseTokens ?? undefined : undefined,
    provider: openrouter && settings.openrouterProvider ? { only: [settings.openrouterProvider], allow_fallbacks: false } : undefined,
    temperature: settings.temperature ?? undefined,
    top_p: settings.topP ?? undefined,
    top_k: settings.topK ?? undefined,
    tools: tools.length ? tools.map((tool) => ({ type: 'function', function: tool })) : undefined,
    tool_choice: tools.length
      ? typeof toolChoice === 'object' ? { type: 'function', function: toolChoice } : toolChoice
      : undefined,
  };
}

function chatReason(reason: string): LlmFinishReason {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool_calls':
    case 'function_call': return 'tool_calls';
    case 'content_filter': return 'content_filter';
    default: return 'other';
  }
}

async function* readChat(frames: AsyncIterable<ProviderFrame>, output: ProviderOutput, stream: boolean, provider: 'openai' | 'openrouter' | 'custom' = 'openai') {
  const openrouter = provider === 'openrouter';
  const calls = new Map<number, { id?: string; name?: string; args: string; position: number }>();
  const reasoning: JsonObject[] = [];
  const reasoningByIndex = new Map<number, JsonObject>();
  let done = false;
  for await (const frame of frames) {
    if (stream && frame.data.trim() === '[DONE]') {
      done = true;
      break;
    }
    const value = providerObject(frame);
    const usage = record(value.usage);
    if (usage) output.tokens(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens);
    const choice = record(list(value.choices)[0]);
    if (!choice) continue;
    if (choice.finish_reason === 'error') throw upstreamError(record(choice.error)?.code);
    const message = record(stream ? choice.delta : choice.message);
    let detailText = '';
    if (openrouter) {
      for (const detail of list(message?.reasoning_details)) {
        if (!jsonObject(detail)) continue;
        const visible = detail.type === 'reasoning.text' ? detail.text : detail.type === 'reasoning.summary' ? detail.summary : undefined;
        if (typeof visible === 'string') detailText += visible;
        const index = tokenCount(detail.index);
        const previous = stream && index !== undefined ? reasoningByIndex.get(index) : undefined;
        if (previous && previous.type === detail.type && (previous.id == null || detail.id == null || previous.id === detail.id)) {
          if (previous.id == null && typeof detail.id === 'string') previous.id = detail.id;
          for (const field of ['text', 'summary', 'data', 'signature'] as const) {
            const fragment = detail[field];
            const accumulated = previous[field];
            if (typeof fragment === 'string') previous[field] = (typeof accumulated === 'string' ? accumulated : '') + fragment;
          }
        } else {
          reasoning.push(detail);
          if (index !== undefined) reasoningByIndex.set(index, detail);
        }
      }
    }
    const reasoningText = typeof message?.reasoning === 'string' ? message.reasoning : '';
    const reasoningDelta = output.reasoning(detailText || reasoningText || message?.reasoning_content);
    if (reasoningDelta) yield reasoningDelta;
    const text = output.text(message?.content ?? message?.refusal);
    if (text) yield text;
    for (const [position, raw] of list(message?.tool_calls).entries()) {
      const call = record(raw);
      const fn = record(call?.function);
      const index = stream ? tokenCount(call?.index) : position;
      if (!fn || index === undefined) invalidResponse();
      const pending = calls.get(index) ?? { args: '', position: output.reserveCall() };
      if (typeof call?.id === 'string' && call.id) pending.id = call.id;
      if (typeof fn.name === 'string' && fn.name) pending.name = fn.name;
      if (typeof fn.arguments === 'string') pending.args += fn.arguments;
      calls.set(index, pending);
    }
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      output.finish = { reason: chatReason(choice.finish_reason), raw: choice.finish_reason };
    }
  }
  if ((stream && !done && provider !== 'custom') || !output.finish) invalidResponse();
  if (reasoning.length) output.openrouterReasoning = reasoning;
  if (output.finish.reason === 'length' || output.finish.reason === 'content_filter') return;
  for (const call of calls.values()) {
    output.call(readCall(call.id, call.name, parseObject(call.args)), call.position);
  }
}

type AnthropicTurn = { role: 'user' | 'assistant'; content: object[] };

function anthropicRequest({ settings, messages, tools, toolChoice, stream, includeReasoning }: GenerationInput) {
  const system: string[] = [];
  const turns: AnthropicTurn[] = [];
  function append(role: AnthropicTurn['role'], blocks: object[]) {
    const last = turns.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else turns.push({ role, content: blocks });
  }
  for (const message of messages) {
    switch (message.role) {
      case 'system': system.push(message.content); break;
      case 'user': append('user', [{ type: 'text', text: message.content }]); break;
      case 'assistant':
        append('assistant', message.parts.flatMap<object>((part) => {
          if (part.type === 'text') return part.text ? [{ type: 'text', text: part.text }] : [];
          if (part.type === 'anthropicThinking') return [part.block];
          if (part.type === 'toolCall') return [{ type: 'tool_use', id: part.id, name: part.name, input: part.arguments }];
          return [];
        }));
        break;
      case 'tool':
        append('user', [{
          type: 'tool_result', tool_use_id: message.callId, content: toolText(message.content), is_error: message.isError,
        }]);
        break;
    }
  }
  const choice = typeof toolChoice === 'object' ? { type: 'tool', name: toolChoice.name }
    : toolChoice ? { type: toolChoice === 'required' ? 'any' : toolChoice } : undefined;
  const forcesTool = choice?.type === 'any' || choice?.type === 'tool';
  const adaptive = /^claude-(?:(?:opus|sonnet|haiku|fable|mythos)-5(?:-|$)|mythos-preview(?:-|$))/i.test(settings.model);
  const adaptive4 = /^claude-(?:opus-4-[678]|sonnet-4-6)(?:-|$)/i.test(settings.model) &&
    settings.temperature == null && settings.topK == null && (settings.topP == null || settings.topP >= 0.95);
  return {
    model: settings.model, stream, messages: turns,
    system: system.length ? system.join('\n\n') : undefined,
    max_tokens: settings.responseTokens ?? 4096,
    temperature: settings.temperature ?? undefined,
    top_p: settings.topP ?? undefined,
    top_k: settings.topK ?? undefined,
    thinking: includeReasoning && (adaptive || adaptive4) && !forcesTool
      ? { type: 'adaptive', display: 'summarized' } : undefined,
    tools: tools.length ? tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters })) : undefined,
    tool_choice: tools.length ? choice : undefined,
  };
}

function anthropicFinish(reason: unknown, output: ProviderOutput) {
  if (typeof reason !== 'string' || !reason) return;
  const reasons = new Map<string, LlmFinishReason>([
    ['end_turn', 'stop'], ['stop_sequence', 'stop'], ['max_tokens', 'length'],
    ['model_context_window_exceeded', 'length'], ['tool_use', 'tool_calls'], ['refusal', 'content_filter'],
  ]);
  output.finish = { reason: reasons.get(reason) ?? 'other', raw: reason };
}

async function* readAnthropic(frames: AsyncIterable<ProviderFrame>, output: ProviderOutput, stream: boolean) {
  const calls = new Map<number, {
    id: unknown; name: unknown; input: unknown; fragments: string; closed: boolean; position: number;
  }>();
  let thinking: { index: number; text: string; signature: string } | undefined;
  let usage: Record<string, unknown> = {};
  function updateUsage(value: unknown) {
    const counts = { ...usage, ...record(value) };
    usage = counts;
    const input = tokenCount(counts.input_tokens);
    const cached = (tokenCount(counts.cache_read_input_tokens) ?? 0) + (tokenCount(counts.cache_creation_input_tokens) ?? 0);
    output.tokens(input === undefined ? undefined : input + cached, counts.output_tokens);
  }
  let ended = false;
  for await (const frame of frames) {
    const value = providerObject(frame);
    if (!stream) {
      for (const [index, raw] of list(value.content).entries()) {
        const block = record(raw);
        if (block?.type === 'text') {
          const text = output.text(block.text);
          if (text) yield text;
        } else if (block?.type === 'tool_use') {
          calls.set(index, {
            id: block.id, name: block.name, input: block.input, fragments: '', closed: true, position: output.reserveCall(),
          });
        } else {
          const native = readAnthropicThinking(block);
          if (native) output.append({ type: 'anthropicThinking', block: native });
          if (block?.type === 'thinking') {
            const delta = output.reasoning(block.thinking);
            if (delta) yield delta;
          }
        }
      }
      updateUsage(value.usage);
      anthropicFinish(value.stop_reason, output);
      ended = true;
      continue;
    }
    const index = tokenCount(value.index);
    switch (value.type) {
      case 'message_start': updateUsage(record(value.message)?.usage); break;
      case 'content_block_start': {
        const block = record(value.content_block);
        if (block?.type === 'text') {
          const text = output.text(block.text);
          if (text) yield text;
        } else if (block?.type === 'tool_use') {
          if (index === undefined || calls.has(index)) invalidResponse();
          calls.set(index, {
            id: block.id, name: block.name, input: block.input, fragments: '', closed: false, position: output.reserveCall(),
          });
        } else if (block?.type === 'thinking' && index !== undefined) {
          thinking = { index, text: typeof block.thinking === 'string' ? block.thinking : '', signature: '' };
          const delta = output.reasoning(thinking.text);
          if (delta) yield delta;
        } else if (block?.type === 'redacted_thinking') {
          const native = readAnthropicThinking(block);
          if (native) output.append({ type: 'anthropicThinking', block: native });
        }
        break;
      }
      case 'content_block_delta': {
        const delta = record(value.delta);
        if (delta?.type === 'text_delta') {
          const text = output.text(delta.text);
          if (text) yield text;
        } else if (delta?.type === 'input_json_delta') {
          const call = index === undefined ? undefined : calls.get(index);
          if (!call || call.closed || typeof delta.partial_json !== 'string') invalidResponse();
          call.fragments += delta.partial_json;
        } else if (thinking && index === thinking.index) {
          if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            thinking.text += delta.thinking;
            const fragment = output.reasoning(delta.thinking);
            if (fragment) yield fragment;
          } else if (delta?.type === 'signature_delta' && typeof delta.signature === 'string') {
            thinking.signature += delta.signature;
          }
        }
        break;
      }
      case 'content_block_stop': {
        const call = index === undefined ? undefined : calls.get(index);
        if (call) call.closed = true;
        if (thinking && index === thinking.index) {
          const block = readAnthropicThinking({ type: 'thinking', thinking: thinking.text, signature: thinking.signature });
          if (block) output.append({ type: 'anthropicThinking', block });
          thinking = undefined;
        }
        break;
      }
      case 'message_delta':
        updateUsage(value.usage);
        anthropicFinish(record(value.delta)?.stop_reason, output);
        break;
      case 'message_stop': ended = true; break;
    }
    if (ended) break;
  }
  if (!ended || !output.finish) invalidResponse();
  if (output.finish.reason === 'length' || output.finish.reason === 'content_filter') return;
  for (const call of calls.values()) {
    if (!call.closed) invalidResponse();
    output.call(readCall(call.id, call.name, call.fragments ? parseObject(call.fragments) : call.input), call.position);
  }
}

type GeminiTurn = { role: 'user' | 'model'; parts: object[] };

function geminiRequest({ settings, messages, tools, toolChoice, includeReasoning }: GenerationInput) {
  const system: { text: string }[] = [];
  const contents: GeminiTurn[] = [];
  let previousCalls: LlmToolCall[] = [];
  const results = new Map<string, Extract<LlmMessage, { role: 'tool' }>>();
  function append(role: GeminiTurn['role'], parts: object[]) {
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  for (const message of messages) {
    switch (message.role) {
      case 'system': system.push({ text: message.content }); break;
      case 'user': append('user', [{ text: message.content }]); break;
      case 'assistant':
        previousCalls = [];
        append('model', message.parts.flatMap<object>((part) => {
          if (part.type === 'anthropicThinking') return [];
          const thoughtSignature = part.geminiSignature;
          if (part.type === 'text') return [{ text: part.text, thoughtSignature }];
          if (part.type === 'geminiThought') return [{ text: part.text, thought: true, thoughtSignature }];
          previousCalls.push(part);
          return [{ functionCall: { id: part.geminiId, name: part.name, args: part.arguments }, thoughtSignature }];
        }));
        break;
      case 'tool':
        results.set(message.callId, message);
        if (results.size === previousCalls.length) {
          append('user', previousCalls.map(({ id, name, geminiId }) => {
            const { content, isError } = results.get(id)!;
            return { functionResponse: { id: geminiId, name, response: { [isError ? 'error' : 'output']: content } } };
          }));
          results.clear();
        }
        break;
    }
  }
  const forced = typeof toolChoice === 'object';
  const mode = forced || toolChoice === 'required' ? 'ANY' : toolChoice === 'none' ? 'NONE' : 'AUTO';
  const supportsThoughts = /^gemini-(?:(?:2\.5|[3-9](?:\.\d+)?)-(?:flash|pro)|(?:flash|pro)-latest|4-hydrogen)(?:-|$)/i.test(settings.model) &&
    !/-(?:image|tts|live|native-audio)(?:-|$)/i.test(settings.model);
  const generationConfig = {
    maxOutputTokens: settings.responseTokens ?? undefined,
    temperature: settings.temperature ?? undefined,
    topP: settings.topP ?? undefined,
    topK: settings.topK ?? undefined,
    ...(includeReasoning && supportsThoughts && { thinkingConfig: { includeThoughts: true } }),
  };
  return {
    contents, systemInstruction: system.length ? { parts: system } : undefined,
    generationConfig,
    tools: tools.length ? [{
      functionDeclarations: tools.map(({ name, description, parameters }) => ({ name, description, parametersJsonSchema: parameters })),
    }] : undefined,
    toolConfig: tools.length && toolChoice
      ? { functionCallingConfig: { mode, allowedFunctionNames: forced ? [toolChoice.name] : undefined } }
      : undefined,
  };
}

function geminiReason(reason: string): LlmFinishReason {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'MODEL_ARMOR': return 'content_filter';
    default: return 'other';
  }
}

async function* readGemini(frames: AsyncIterable<ProviderFrame>, output: ProviderOutput) {
  for await (const frame of frames) {
    const value = providerObject(frame);
    const usage = record(value.usageMetadata);
    if (usage) {
      const candidates = tokenCount(usage.candidatesTokenCount);
      const thoughts = tokenCount(usage.thoughtsTokenCount);
      const generated = candidates === undefined && thoughts === undefined ? undefined : (candidates ?? 0) + (thoughts ?? 0);
      output.tokens(usage.promptTokenCount, generated, usage.totalTokenCount);
    }
    const blocked = record(value.promptFeedback)?.blockReason;
    if (typeof blocked === 'string' && blocked !== 'BLOCK_REASON_UNSPECIFIED') {
      output.finish = { reason: 'content_filter', raw: blocked };
    }
    const candidate = record(list(value.candidates)[0]);
    if (!candidate) continue;
    for (const raw of list(record(candidate.content)?.parts)) {
      const part = record(raw);
      if (!part) continue;
      const signature = typeof part.thoughtSignature === 'string' ? part.thoughtSignature : undefined;
      const call = record(part.functionCall);
      if (call) {
        const geminiId = typeof call.id === 'string' && call.id ? call.id : undefined;
        const id = geminiId ?? `call_${crypto.randomUUID()}`;
        output.call({ ...readCall(id, call.name, call.args ?? {}), geminiId, geminiSignature: signature });
      } else if (part.thought === true) {
        if (signature) output.append({ type: 'geminiThought', text: typeof part.text === 'string' ? part.text : '', geminiSignature: signature });
        const delta = output.reasoning(part.text);
        if (delta) yield delta;
      } else {
        const text = output.text(part.text ?? '', signature);
        if (text) yield text;
      }
    }
    const reason = candidate.finishReason;
    if (typeof reason === 'string' && reason !== 'FINISH_REASON_UNSPECIFIED') {
      output.finish = { reason: geminiReason(reason), raw: reason };
    }
  }
  if (!output.finish) invalidResponse();
}

const chatAdapter: Adapter = { request: chatRequest, read: readChat };
export const providerAdapters = {
  openai: chatAdapter,
  openrouter: {
    request: (input) => chatRequest(input, 'openrouter'),
    read: (frames, output, stream) => readChat(frames, output, stream, 'openrouter'),
  },
  custom: {
    request: (input) => chatRequest(input, 'custom'),
    read: (frames, output, stream) => readChat(frames, output, stream, 'custom'),
  },
  anthropic: { request: anthropicRequest, read: readAnthropic },
  gemini: { request: geminiRequest, read: readGemini },
} satisfies Record<string, Adapter>;
