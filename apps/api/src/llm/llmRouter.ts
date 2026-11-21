import { once } from 'node:events';
import { Router } from 'express';
import type { LlmEvent } from '@kuroko/contracts/llm';
import { LlmError } from './llmErrors';
import type { createLlmService } from './llmService';
import { readLlmRequest } from './readLlmRequest';

function sse(event: LlmEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function createLlmRouter(llm: ReturnType<typeof createLlmService>) {
  const router = Router();

  router.post('/generate', async (request, response) => {
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.once('close', disconnect);
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    function start() {
      response.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      heartbeat = setInterval(() => {
        if (!response.destroyed && !response.writableNeedDrain) response.write(': keep-alive\n\n');
      }, 15_000);
    }

    async function emit(event: LlmEvent, signal = controller.signal) {
      signal.throwIfAborted();
      if (!response.write(sse(event))) {
        await once(response, 'drain', { signal });
      }
    }

    try {
      const input = readLlmRequest(request.body);
      const completion = await llm.generate(response.locals.user.id, input, controller.signal, input.stream ? { start, emit } : undefined);
      if (input.stream) {
        if (!controller.signal.aborted) response.end(sse({ type: 'done', completion }));
      } else {
        response.json(completion);
      }
    } catch (error) {
      if (controller.signal.aborted || response.destroyed) return;
      const failure = error instanceof LlmError ? error : new LlmError('internal_error');
      if (response.headersSent) {
        response.end(sse({ type: 'error', ...failure.body }));
      } else {
        response.status(failure.status).json(failure.body);
      }
    } finally {
      clearInterval(heartbeat);
      response.off('close', disconnect);
    }
  });
  return router;
}
