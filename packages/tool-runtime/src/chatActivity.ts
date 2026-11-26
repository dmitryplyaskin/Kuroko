import type { ChatActivityEntry } from '@kuroko/contracts/chat';
import type { JsonObject, LlmCompletion, LlmRequest } from '@kuroko/contracts/llm';

export function chatInstructionActivity(instruction: string): ChatActivityEntry {
  return { id: '0', kind: 'instruction', status: 'completed', time: Date.now(), details: { instruction } };
}

export function createChatActivity(report: (entry: ChatActivityEntry) => void) {
  let nextId = 0;
  return (kind: ChatActivityEntry['kind'], details: JsonObject, name?: string) => {
    const entry: ChatActivityEntry = { id: String(++nextId), kind, time: Date.now(), name, details, status: 'running' };
    report(entry);
    return {
      id: entry.id,
      finish(status: Exclude<ChatActivityEntry['status'], 'running'>, details: JsonObject, name = entry.name) {
        report({ ...entry, name, status, duration: Math.max(0, Date.now() - entry.time), details: { ...entry.details, ...details } });
      },
    };
  };
}

export function recordModelRequest(
  start: ReturnType<typeof createChatActivity>, { messages, tools, ...options }: LlmRequest,
  generate: () => Promise<LlmCompletion>, signal: AbortSignal, errorCode: (error: unknown) => string,
) {
  const last = messages.at(-1);
  const model = start('model', {
    request: {
      ...options, messageCount: messages.length, tools: tools?.map(({ name }) => name) ?? [],
      ...(last?.role === 'user' && { input: last.content }),
    },
  });
  return generate().then((completion) => {
    model.finish('completed', { response: completion }, completion.model);
    return completion;
  }, (error: unknown) => {
    model.finish(signal.aborted ? 'stopped' : 'failed', { error: errorCode(error) });
    throw error;
  });
}
