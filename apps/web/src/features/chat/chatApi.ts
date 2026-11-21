import type { LlmEvent, LlmRequest } from '@kuroko/contracts/llm';
import type { ActiveSession } from '../../platform/session/model';
import { sessionResponse } from '../../platform/session/request';
import { ApiError } from '../../shared/http/api';

const invalidStream = 'Сервер вернул некорректный ответ.';

function readEvent(frame: string): LlmEvent | undefined {
  const lines = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'));
  if (!lines.length) return;
  try {
    const event = JSON.parse(lines.map((line) => line.slice(5).replace(/^ /, '')).join('\n')) as LlmEvent | null;
    if (event && typeof event.type === 'string') return event;
  } catch {
    // An invalid frame must fail the request without discarding text already displayed.
  }
  throw new ApiError(502, invalidStream);
}

export async function streamChatReply(
  session: ActiveSession, text: string, signal: AbortSignal, onText: (delta: string) => void,
): Promise<string> {
  // By omitting presetId, each send uses the account's active preset at request time.
  const body: LlmRequest = { messages: [{ role: 'user', content: text }], stream: true };
  const response = await sessionResponse(session, '/llm/generate', {
    method: 'POST', body, signal, accept: 'text/event-stream', timeoutMs: 130_000,
  });
  const mediaType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!response.body || mediaType !== 'text/event-stream') {
    void response.body?.cancel().catch(() => undefined);
    throw new ApiError(502, invalidStream);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new ApiError(502, 'Поток оборвался до завершения ответа.');
      pending += value;
      while (true) {
        const boundary = /\r?\n\r?\n/.exec(pending);
        if (!boundary) break;
        const event = readEvent(pending.slice(0, boundary.index));
        pending = pending.slice(boundary.index + boundary[0].length);
        if (event?.type === 'text_delta' && typeof event.text === 'string') onText(event.text);
        if (event?.type === 'error') {
          throw new ApiError(502, typeof event.error === 'string' ? event.error : invalidStream);
        }
        if (event?.type === 'done') {
          const parts = event.completion?.message?.parts;
          if (!Array.isArray(parts)) throw new ApiError(502, invalidStream);
          const answer = parts.flatMap((part) => part?.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('');
          if (answer.trim()) return answer;
          const blocked = event.completion.finishReason === 'content_filter';
          throw new ApiError(422, blocked ? 'Провайдер заблокировал ответ.' : 'Модель завершила запрос без текстового ответа.');
        }
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
