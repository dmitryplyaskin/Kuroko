import { once } from 'node:events';
import { Router } from 'express';
import { errorBody } from '@kuroko/contracts/errors';
import type { LlmEvent } from '@kuroko/contracts/llm';
import {
  delegatedAnswerLimit, readDelegatedTask, readSubagentName, subagentHistoryLimit, subagentHistoryTextLimit,
  type DelegateTaskRequest, type SubagentTurn,
} from '@kuroko/contracts/tools';
import type { createDelegateTask } from '../tools/delegateTask';
import { record } from './json';
import { LlmError } from './llmErrors';
import type { createLlmService } from './llmService';
import { readLlmRequest } from './readLlmRequest';

function sse(event: LlmEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function readDelegation(value: unknown): DelegateTaskRequest | undefined {
  const input = record(value);
  const task = readDelegatedTask(input?.task);
  if (!input || !task) return;
  const name = readSubagentName(input.name);
  if (input.name !== undefined && !name) return;
  if (input.history === undefined) return { task, name };
  if (!name || !Array.isArray(input.history) || input.history.length > subagentHistoryLimit) return;

  const history: SubagentTurn[] = [];
  let size = 0;
  for (const item of input.history as unknown[]) {
    const turn = record(item);
    const previousTask = readDelegatedTask(turn?.task);
    const answer = turn?.answer;
    if (!previousTask || typeof answer !== 'string' || answer.length > delegatedAnswerLimit || !answer.isWellFormed() || !answer.trim()) return;
    size += previousTask.length + answer.length;
    if (size > subagentHistoryTextLimit) return;
    history.push({ task: previousTask, answer });
  }
  return { task, name, history };
}

export function createLlmRouter(llm: ReturnType<typeof createLlmService>, delegateTask: ReturnType<typeof createDelegateTask>) {
  const router = Router();

  router.post('/delegate', async (request, response) => {
    const input = readDelegation(request.body);
    if (!input) {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }

    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.once('close', disconnect);
    try {
      const result = await delegateTask(response.locals.user.id, input, controller.signal);
      if (!controller.signal.aborted) response.json(result);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      response.off('close', disconnect);
    }
  });

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
