import { isLlmErrorCode } from '@kuroko/contracts/errors';
import type { ChatSnapshot, ChatSummary, ChatToolCall, SavedChat } from '@kuroko/contracts/chat';
import type { LlmAssistantPart, LlmCompletion, LlmEvent, LlmMessage, LlmRequest, LlmToolCall } from '@kuroko/contracts/llm';
import type { ToolId } from '@kuroko/contracts/tools';
import { runToolCall, toolDeclarations } from '@kuroko/tool-runtime';
import { toLlmMessages } from '@kuroko/tool-runtime/chatHistory';
import type { ActiveSession } from '../../platform/session/model';
import { sessionRequest, sessionResponse } from '../../platform/session/request';
import { ApiError } from '../../shared/http/api';

export const chatApi = {
  list: (session: ActiveSession) => sessionRequest<ChatSummary[]>(session, '/chats'),
  create: (session: ActiveSession) => sessionRequest<SavedChat>(session, '/chats', { method: 'POST' }),
  open: (session: ActiveSession, id: string) => sessionRequest<SavedChat>(session, `/chats/${encodeURIComponent(id)}`),
  save: (session: ActiveSession, id: string, body: ChatSnapshot) =>
    sessionRequest<SavedChat>(session, `/chats/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  gmReply: (session: ActiveSession, { id, revision }: SavedChat, signal: AbortSignal) =>
    sessionRequest<SavedChat>(session, `/chats/${encodeURIComponent(id)}/gm-reply`, {
      method: 'POST', body: { revision }, signal, timeoutMs: 310_000,
    }),
};

const maxToolRounds = 16;

function readEvent(frame: string): LlmEvent | undefined {
  const lines = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'));
  if (!lines.length) return;
  try {
    const event = JSON.parse(lines.map((line) => line.slice(5).replace(/^ /, '')).join('\n')) as LlmEvent | null;
    if (event && typeof event.type === 'string') return event;
  } catch {
    // An invalid frame must fail the request without discarding text already displayed.
  }
  throw new ApiError(502, 'invalid_response');
}

export async function streamChatReply(
  session: ActiveSession, messages: ChatSnapshot['messages'], enabledTools: readonly ToolId[], signal: AbortSignal,
  onText: (delta: string) => void, onContent: (text: string, calls: ChatToolCall[]) => void,
): Promise<string> {
  const tools = enabledTools.length ? toolDeclarations(enabledTools) : undefined;
  const history: LlmMessage[] = toLlmMessages(messages);
  const savedCalls = messages.flatMap(({ toolCalls }) => toolCalls ?? []);
  const toolCalls: ChatToolCall[] = [];
  const recordedIds = new Set(savedCalls.map(({ id }) => id));
  let nextRecordNumber = 1;
  let presetId: string | undefined;
  let text = '';

  for (let round = 0; ; round++) {
    signal.throwIfAborted();
    const separator = text.trim() ? '\n\n' : '';
    let startsParagraph = Boolean(separator);
    const completion = await streamCompletion(session, {
      presetId, messages: history, stream: true, tools, toolChoice: presetId && tools ? 'auto' : undefined,
    }, signal, (delta) => {
      if (!delta) return;
      onText(startsParagraph ? separator + delta : delta);
      startsParagraph = false;
    });
    const { text: roundText, calls } = readToolTurn(completion.message.parts);
    const start = text.length + (roundText ? separator.length : 0);
    if (roundText) text += separator + roundText;

    if (completion.finishReason === 'length') {
      onContent(text, toolCalls);
      throw new ApiError(422, 'response_length');
    }
    if (!tools || !calls.length) {
      if (roundText.trim()) return text;
      throw new ApiError(422, completion.finishReason === 'content_filter' ? 'response_blocked' : 'response_empty');
    }
    if (round === maxToolRounds) {
      onContent(text, toolCalls);
      throw new ApiError(422, 'tool_round_limit');
    }

    signal.throwIfAborted();
    if (typeof completion.presetId !== 'string') throw new ApiError(502, 'invalid_response');
    presetId ??= completion.presetId;
    const recordedCalls = [...savedCalls, ...toolCalls];
    const results = await Promise.all(calls.map(async ({ call, textOffset }) => {
      let recordId = call.id;
      while (recordedIds.has(recordId)) recordId = `call_${nextRecordNumber++}`;
      recordedIds.add(recordId);
      const { entry, message } = await runToolCall(call, enabledTools, { signal, id: recordId, history: recordedCalls });
      return { entry: { ...entry, textOffset: start + textOffset }, message };
    }));
    signal.throwIfAborted();
    toolCalls.push(...results.map(({ entry }) => entry));
    onContent(text, [...toolCalls]);
    history.push(completion.message, ...results.map(({ message }) => message));
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
  session: ActiveSession, body: LlmRequest, signal: AbortSignal, onText: (delta: string) => void,
): Promise<LlmCompletion> {
  const response = await sessionResponse(session, '/llm/generate', {
    method: 'POST', body, signal, accept: 'text/event-stream', timeoutMs: 130_000,
  });
  const mediaType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!response.body || mediaType !== 'text/event-stream') {
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
        if (event?.type === 'text_delta' && typeof event.text === 'string') onText(event.text);
        if (event?.type === 'error') {
          throw new ApiError(502, isLlmErrorCode(event.code) ? event.code : 'invalid_response');
        }
        if (event?.type === 'done') {
          if (!Array.isArray(event.completion?.message?.parts)) throw new ApiError(502, 'invalid_response');
          return event.completion;
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
