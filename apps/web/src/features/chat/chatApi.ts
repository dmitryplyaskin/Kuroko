import { isLlmErrorCode } from '@kuroko/contracts/errors';
import type { ChatActivityEntry, ChatCreateRequest, ChatListItem, ChatReasoningBlock, ChatReplyVariantSelection, ChatSnapshot, ChatSummary, ChatToolCall, SavedChat } from '@kuroko/contracts/chat';
import type { ActiveChatInstruction } from '@kuroko/contracts/instructions';
import type { LlmAssistantPart, LlmCompletion, LlmEvent, LlmMessage, LlmRequest, LlmTextDelta, LlmToolCall } from '@kuroko/contracts/llm';
import { readSubagentResultName, type DelegateTaskEvent, type DelegateTaskRequest, type DelegateTaskResult, type ToolId } from '@kuroko/contracts/tools';
import { createSubagentBatch, runToolCall, toolDeclarations } from '@kuroko/tool-runtime';
import { chatInstructionActivity, createChatActivity, recordModelRequest } from '@kuroko/tool-runtime/chatActivity';
import { toLlmMessages } from '@kuroko/tool-runtime/chatHistory';
import type { ActiveSession } from '../../platform/session/model';
import { sessionRequest, sessionResponse } from '../../platform/session/request';
import { ApiError, errorCode } from '../../shared/http/api';
import type { ActiveSubagent } from './message';

export const chatApi = {
  list: (session: ActiveSession, signal?: AbortSignal) => sessionRequest<ChatListItem[]>(session, '/chats', { signal }),
  create: (session: ActiveSession, body?: ChatCreateRequest) => sessionRequest<SavedChat>(session, '/chats', { method: 'POST', body }),
  open: (session: ActiveSession, id: string) => sessionRequest<SavedChat>(session, `/chats/${encodeURIComponent(id)}`),
  rename: (session: ActiveSession, id: string, title: string) =>
    sessionRequest<ChatSummary>(session, `/chats/${encodeURIComponent(id)}/title`, { method: 'PUT', body: { title } }),
  remove: (session: ActiveSession, id: string) =>
    sessionRequest<void>(session, `/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  save: (session: ActiveSession, id: string, body: ChatSnapshot) =>
    sessionRequest<SavedChat>(session, `/chats/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  selectVariant: (session: ActiveSession, id: string, body: ChatReplyVariantSelection & { revision: number }) =>
    sessionRequest<SavedChat>(session, `/chats/${encodeURIComponent(id)}/reply-variant`, { method: 'PUT', body }),
  gmReply: (session: ActiveSession, { id, revision }: SavedChat, signal: AbortSignal, replaceId?: number) =>
    sessionRequest<SavedChat>(session, `/chats/${encodeURIComponent(id)}/gm-reply`, {
      method: 'POST', body: { revision, replaceId }, signal, timeoutMs: 310_000,
    }),
};

export function readChatPrompt(session: ActiveSession, chatId: string, signal: AbortSignal, replaceId?: number) {
  const query = new URLSearchParams({ chat: chatId });
  if (replaceId !== undefined) query.set('replace', String(replaceId));
  return sessionRequest<ActiveChatInstruction>(session, `/settings/instructions/active?${query}`, { signal });
}

export function chatPromptMessages({ text, messages }: ActiveChatInstruction, fallback: ChatSnapshot['messages']): LlmMessage[] {
  const history = messages ?? toLlmMessages(fallback);
  return text ? [{ role: 'system', content: text }, ...history] : history;
}

const maxToolRounds = 16;

export type ChatReplyDelta = Extract<LlmTextDelta, { type: 'text_delta' }> | ({ type: 'reasoning_delta' } & ChatReasoningBlock);

function readEvent(frame: string): LlmEvent | DelegateTaskEvent | undefined {
  const lines = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'));
  if (!lines.length) return;
  try {
    const event = JSON.parse(lines.map((line) => line.slice(5).replace(/^ /, '')).join('\n')) as LlmEvent | DelegateTaskEvent | null;
    if (event && typeof event.type === 'string') return event;
  } catch {
    // An invalid frame must fail the request without discarding text already displayed.
  }
  throw new ApiError(502, 'invalid_response');
}

export async function streamChatReply(
  session: ActiveSession, chatId: string, messages: ChatSnapshot['messages'], enabledTools: readonly ToolId[], signal: AbortSignal,
  onDelta: (delta: ChatReplyDelta) => void, onContent: (text: string, calls: ChatToolCall[], reasoning: ChatReasoningBlock[]) => void,
  onSubagentActivity: (active: readonly ActiveSubagent[]) => void, start: ReturnType<typeof createChatActivity>,
  onActivity: (entry: ChatActivityEntry) => void, uniqueToolIds: boolean, replaceId?: number,
): Promise<string> {
  const tools = enabledTools.length ? toolDeclarations(enabledTools) : undefined;
  const prompt = await readChatPrompt(session, chatId, signal, replaceId);
  const history = chatPromptMessages(prompt, messages);
  if (prompt.text) onActivity(chatInstructionActivity(prompt.text));
  const savedCalls = messages.flatMap(({ toolCalls }) => toolCalls ?? []);
  const toolCalls: ChatToolCall[] = [];
  const recordedIds = new Set(savedCalls.map(({ id }) => id));
  // A provider can reuse an ID from an inactive variant that is absent from model history.
  const recordPrefix = uniqueToolIds ? `call_${crypto.getRandomValues(new Uint32Array(4)).join('_')}_` : 'call_';
  let nextRecordNumber = 1;
  let presetId: string | undefined;
  let text = '';
  const reasoningBlocks: ChatReasoningBlock[] = [];
  let activeSubagents: readonly ActiveSubagent[] = [];

  for (let round = 0; ; round++) {
    signal.throwIfAborted();
    const separator = text.trim() ? '\n\n' : '';
    let startsParagraph = Boolean(separator);
    let roundReasoning = '';
    const afterToolCallId = toolCalls.at(-1)?.id;
    const textOffset = text.length;
    const request: LlmRequest = {
      presetId, messages: history, stream: true, includeReasoning: true, tools, toolChoice: presetId && tools ? 'auto' : undefined,
    };
    const completion = await recordModelRequest(start, request, () => streamCompletion(session, request, signal, ({ type, text: delta }) => {
      if (!delta) return;
      if (type === 'reasoning_delta') {
        onDelta({ type, text: delta, textOffset, afterToolCallId });
        roundReasoning += delta;
      } else {
        onDelta({ type, text: startsParagraph ? separator + delta : delta });
        startsParagraph = false;
      }
    }), signal, errorCode);
    const completedReasoning = completion.reasoning ?? roundReasoning;
    if (completedReasoning.trim()) {
      reasoningBlocks.push({ text: completedReasoning.toWellFormed(), textOffset, ...(afterToolCallId && { afterToolCallId }) });
    }
    const { text: roundText, calls } = readToolTurn(completion.message.parts);
    const textStart = text.length + (roundText ? separator.length : 0);
    if (roundText) text += separator + roundText;
    onContent(text, [...toolCalls], [...reasoningBlocks]);

    if (completion.finishReason === 'length') throw new ApiError(422, 'response_length');
    if (!tools || !calls.length) {
      if (roundText.trim()) return text;
      throw new ApiError(422, completion.finishReason === 'content_filter' ? 'response_blocked' : 'response_empty');
    }
    if (round === maxToolRounds) throw new ApiError(422, 'tool_round_limit');

    signal.throwIfAborted();
    if (typeof completion.presetId !== 'string') throw new ApiError(502, 'invalid_response');
    presetId ??= completion.presetId;
    const recordedCalls = [...savedCalls, ...toolCalls];
    const delegateTask = createSubagentBatch(recordedCalls, async (request, signal, id) => {
      const agent = start('agent', {
        task: request.task, callId: id,
        ...(request.agentId && { savedAgentId: request.agentId, ...(request.name && { instanceName: request.name }) }),
      }, request.name);
      const nestedEntries = new Map<string, ChatActivityEntry>();
      activeSubagents = [...activeSubagents, { id, name: request.name }];
      onSubagentActivity(activeSubagents);
      try {
        const result = await requestSubagent(session, request, signal, (entry) => {
          const nested = { ...entry, id: `${agent.id}/${entry.id}`, agentId: agent.id };
          nestedEntries.set(nested.id, nested);
          onActivity(nested);
        });
        // Non-streaming delegation also returns its completed tool calls.
        if (!nestedEntries.size) {
          for (const [index, call] of (result.toolCalls ?? []).entries()) {
            onActivity({
              id: `${agent.id}/${index + 1}`, agentId: agent.id, kind: 'tool', time: Date.now(), name: call.name,
              status: call.isError ? 'failed' : 'completed', details: { arguments: call.arguments, result: call.result },
            });
          }
        }
        for (const entry of nestedEntries.values()) {
          if (entry.status === 'running') onActivity({ ...entry, status: result.isError ? 'failed' : 'completed' });
        }
        agent.finish(result.isError ? 'failed' : 'completed', { result: result.result }, readSubagentResultName(result.result));
        return result;
      } finally {
        activeSubagents = activeSubagents.filter((agent) => agent.id !== id);
        onSubagentActivity(activeSubagents);
      }
    });
    const results = await Promise.all(calls.map(async ({ call, textOffset }) => {
      let recordId = uniqueToolIds ? `${recordPrefix}${nextRecordNumber++}` : call.id;
      while (recordedIds.has(recordId)) recordId = `${recordPrefix}${nextRecordNumber++}`;
      recordedIds.add(recordId);
      const tool = start('tool', { arguments: call.arguments, ...(call.name === 'subagent' && { callId: recordId }) }, call.name);
      const { entry, message } = await runToolCall(call, enabledTools, { signal, id: recordId, history: recordedCalls, delegateTask });
      tool.finish(entry.isError ? 'failed' : 'completed', {
        result: entry.result, ...(message.content !== entry.result && { modelResult: message.content }),
      });
      return { entry: { ...entry, textOffset: textStart + textOffset }, message };
    }));
    signal.throwIfAborted();
    toolCalls.push(...results.map(({ entry }) => entry));
    onContent(text, [...toolCalls], [...reasoningBlocks]);
    history.push(completion.message, ...results.map(({ message }) => message));
  }
}

async function requestSubagent(
  session: ActiveSession, body: DelegateTaskRequest, signal: AbortSignal, onActivity: (entry: ChatActivityEntry) => void,
): Promise<DelegateTaskResult> {
  try {
    const response = await sessionResponse(session, '/llm/delegate', {
      method: 'POST', body, signal, accept: 'text/event-stream', timeoutMs: 130_000,
    });
    if (mediaType(response) === 'application/json') return await response.json() as DelegateTaskResult;
    return await readStream(response, (event) => {
      if (event.type === 'activity') onActivity(event.entry);
      if (event.type === 'done' && 'result' in event) return event.result;
    });
  } catch (error) {
    signal.throwIfAborted();
    session.signal.throwIfAborted();
    return { result: `Subagent request failed (${errorCode(error)}).`, isError: true };
  }
}

function readToolTurn(parts: LlmAssistantPart[]) {
  let text = '';
  const calls: { call: LlmToolCall; textOffset: number }[] = [];
  for (const part of parts) {
    if (part?.type === 'text' && typeof part.text === 'string') text += part.text;
    else if (part?.type === 'toolCall') calls.push({ call: part, textOffset: text.length });
  }
  return { text, calls };
}

async function streamCompletion(
  session: ActiveSession, body: LlmRequest, signal: AbortSignal, onDelta: (delta: LlmTextDelta) => void,
): Promise<LlmCompletion> {
  const response = await sessionResponse(session, '/llm/generate', {
    method: 'POST', body, signal, accept: 'text/event-stream', timeoutMs: 130_000,
  });
  return readStream(response, (event) => {
    if ((event.type === 'text_delta' || event.type === 'reasoning_delta') && typeof event.text === 'string') onDelta(event);
    if (event.type === 'done' && 'completion' in event && Array.isArray(event.completion?.message?.parts)) return event.completion;
  });
}

function mediaType(response: Response) {
  return response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
}

async function readStream<T>(response: Response, consume: (event: LlmEvent | DelegateTaskEvent) => T | undefined): Promise<T> {
  if (!response.body || mediaType(response) !== 'text/event-stream') {
    void response.body?.cancel().catch(() => undefined);
    throw new ApiError(502, 'invalid_response');
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new ApiError(502, 'stream_interrupted');
      pending += value;
      while (true) {
        const boundary = /\r?\n\r?\n/.exec(pending);
        if (!boundary) break;
        const event = readEvent(pending.slice(0, boundary.index));
        pending = pending.slice(boundary.index + boundary[0].length);
        if (!event) continue;
        if (event.type === 'error') {
          throw new ApiError(502, isLlmErrorCode(event.code) ? event.code : 'invalid_response');
        }
        const result = consume(event);
        if (result !== undefined) return result;
        if (event.type === 'done') throw new ApiError(502, 'invalid_response');
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
