import type { ChatActivityEntry } from '@kuroko/contracts/chat';
import type { JsonObject, LlmCompletion, LlmRequest } from '@kuroko/contracts/llm';

export function chatInstructionActivity(instruction: string): ChatActivityEntry {
  return { id: '0', kind: 'instruction', status: 'completed', time: Date.now(), details: { instruction } };
}

export function createChatActivity<T>(report: (entry: ChatActivityEntry) => T) {
  let nextId = 0;
  return (kind: ChatActivityEntry['kind'], details: JsonObject, name?: string) => {
    const entry: ChatActivityEntry = { id: String(++nextId), kind, time: Date.now(), name, details, status: 'running' };
    return {
      ready: report(entry),
      id: entry.id,
      finish(status: Exclude<ChatActivityEntry['status'], 'running'>, details: JsonObject, name = entry.name) {
        return report({ ...entry, name, status, duration: Math.max(0, Date.now() - entry.time), details: { ...entry.details, ...details } });
      },
    };
  };
}

export async function recordModelRequest(
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
  await model.ready;
  let completion: LlmCompletion;
  try {
    completion = await generate();
  } catch (error) {
    await model.finish(signal.aborted ? 'stopped' : 'failed', { error: errorCode(error) });
    throw error;
  }
  await model.finish('completed', { response: completion }, completion.model);
  return completion;
}
