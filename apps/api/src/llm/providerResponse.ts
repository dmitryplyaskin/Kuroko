import type { JsonObject, LlmAssistantPart, LlmFinishReason, LlmToolCall, LlmUsage } from '@kuroko/contracts/llm';
import { parseObject, record } from './json';
import { LlmError, upstreamError } from './llmErrors';

export type ProviderFrame = { event?: string; data: string };
const responseByteLimit = 4 * 1024 * 1024;

async function* readBody(body: NonNullable<Response['body']>, signal: AbortSignal) {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  function decode(value?: Uint8Array) {
    try {
      return decoder.decode(value, { stream: value !== undefined });
    } catch {
      throw new LlmError('provider_protocol');
    }
  }
  let bytes = 0;
  let complete = false;
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > responseByteLimit) throw new LlmError('provider_protocol');
      yield decode(value);
    }
    complete = true;
    yield decode();
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

export async function* readProviderFrames(
  body: NonNullable<Response['body']>, stream: boolean, signal: AbortSignal,
): AsyncGenerator<ProviderFrame> {
  let pending = '';
  if (!stream) {
    for await (const chunk of readBody(body, signal)) pending += chunk;
    yield { data: pending };
    return;
  }

  let event: string | undefined;
  let data: string[] = [];
  function readLine(line: string): ProviderFrame | undefined {
    if (!line) {
      const frame = data.length ? { event, data: data.join('\n') } : undefined;
      event = undefined;
      data = [];
      return frame;
    }
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }

  for await (const chunk of readBody(body, signal)) {
    const lines = (pending + chunk).split(/\r\n|\r(?!$)|\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const frame = readLine(line);
      if (frame) yield frame;
    }
  }
  if (pending.endsWith('\r')) {
    const frame = readLine(pending.slice(0, -1));
    if (frame) yield frame;
  }
}

export function providerObject(frame: ProviderFrame) {
  const value = parseObject(frame.data);
  if (frame.event === 'error' || value.type === 'error' || value.error) {
    const error = record(value.error);
    throw upstreamError(error?.code ?? error?.status ?? error?.type);
  }
  return value;
}

export class ProviderOutput {
  private readonly blocks: (LlmAssistantPart | null)[] = [];
  openrouterReasoning?: JsonObject[];
  usage?: LlmUsage;
  finish?: { reason: LlmFinishReason; raw: string };

  get parts(): LlmAssistantPart[] {
    return this.blocks.filter((part) => part !== null);
  }

  append(part: LlmAssistantPart) {
    this.blocks.push(part);
  }

  text(text: unknown, geminiSignature?: string): string | undefined {
    if (typeof text !== 'string' || (!text && !geminiSignature)) return;
    const last = this.blocks.at(-1);
    if (last?.type === 'text' && !last.geminiSignature && !geminiSignature) last.text += text;
    else this.append({ type: 'text', text, geminiSignature });
    return text || undefined;
  }

  reserveCall() {
    return this.blocks.push(null) - 1;
  }

  call(call: Omit<LlmToolCall, 'type'>, position?: number) {
    const part = { type: 'toolCall', ...call } as const;
    if (position === undefined) this.append(part);
    else this.blocks[position] = part;
  }

  tokens(input: unknown, output: unknown, total?: unknown) {
    const inputTokens = tokenCount(input);
    const outputTokens = tokenCount(output);
    const totalTokens = tokenCount(total);
    if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return;

    this.usage ??= {};
    if (inputTokens !== undefined) this.usage.inputTokens = inputTokens;
    if (outputTokens !== undefined) this.usage.outputTokens = outputTokens;
    if (totalTokens !== undefined) this.usage.totalTokens = totalTokens;
  }
}

export function tokenCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
