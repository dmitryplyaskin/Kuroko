import { isLlmErrorCode } from '@kuroko/contracts/errors';
import type { ChatSnapshot, ChatSummary, ChatToolCall, SavedChat } from '@kuroko/contracts/chat';
import type { LlmAssistantPart, LlmCompletion, LlmEvent, LlmMessage, LlmRequest } from '@kuroko/contracts/llm';
import type { ActiveSession } from '../../platform/session/model';
import { sessionRequest, sessionResponse } from '../../platform/session/request';
import { ApiError } from '../../shared/http/api';
import { runTestTool, testTools } from './testTools';

export const chatApi = {
  list: (session: ActiveSession) => sessionRequest<ChatSummary[]>(session, '/chats'),
  create: (session: ActiveSession) => sessionRequest<SavedChat>(session, '/chats', { method: 'POST' }),
  open: (session: ActiveSession, id: string) => sessionRequest<SavedChat>(session, `/chats/${encodeURIComponent(id)}`),
  save: (session: ActiveSession, id: string, body: ChatSnapshot) =>
    sessionRequest<SavedChat>(session, `/chats/${encodeURIComponent(id)}`, { method: 'PUT', body }),
};

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
  session: ActiveSession, messages: LlmMessage[], signal: AbortSignal, onText: (delta: string) => void,
  onTools?: (calls: ChatToolCall[]) => void,
): Promise<string> {
  const tools = onTools ? testTools : undefined;
  const first = await streamCompletion(session, { messages, stream: true, tools }, signal, onText);
  const calls = first.message.parts.filter((part) => part?.type === 'toolCall');
  const initialText = completionText(first.message.parts);
  if (!onTools || !calls.length) return answerText(first, initialText);

  signal.throwIfAborted();
  if (typeof first.presetId !== 'string') throw new ApiError(502, 'invalid_response');
  const results = calls.map(runTestTool);
  onTools(results.map(({ entry }) => entry));
  const separator = initialText.trim() ? '\n\n' : '';
  if (separator) onText(separator);
  const last = await streamCompletion(session, {
    presetId: first.presetId, messages: [...messages, first.message, ...results.map(({ message }) => message)],
    stream: true, tools, toolChoice: 'none',
  }, signal, onText);
  return (separator ? initialText : '') + separator + answerText(last, completionText(last.message.parts));
}

function completionText(parts: LlmAssistantPart[]) {
  return parts.flatMap((part) => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('');
}

function answerText(completion: LlmCompletion, text: string) {
  if (text.trim()) return text;
  throw new ApiError(422, completion.finishReason === 'content_filter' ? 'response_blocked' : 'response_empty');
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
