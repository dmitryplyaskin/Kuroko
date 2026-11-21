import type { ChatMessage, ChatSnapshot, ChatToolCall } from '@kuroko/contracts/chat';
import { errorBody } from '@kuroko/contracts/errors';
import { Router } from 'express';
import { jsonObject, jsonValue, record } from '../llm/json';
import { isToolCallId, isToolName } from '../llm/readLlmRequest';
import type { createChatStore } from './chatStore';

export function createChatRouter(store: ReturnType<typeof createChatStore>) {
  const router = Router();
  router.get('/', (_request, response) => { response.json(store.list(response.locals.user.id)); });
  router.post('/', (_request, response) => { response.status(201).json(store.create(response.locals.user.id)); });
  router.get('/:id', (request, response) => {
    const chat = store.find(response.locals.user.id, request.params.id);
    if (chat) response.json(chat);
    else response.status(404).json(errorBody('chat_not_found'));
  });
  router.put('/:id', (request, response) => {
    const snapshot = readSnapshot(request.body);
    if (!snapshot) {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const result = store.save(response.locals.user.id, request.params.id, snapshot);
    if (result === 'missing') response.status(404).json(errorBody('chat_not_found'));
    else if (result === 'conflict') response.status(409).json(errorBody('chat_conflict'));
    else response.json(result);
  });
  return router;
}

function readSnapshot(value: unknown): ChatSnapshot | undefined {
  const snapshot = record(value);
  if (!snapshot || !nonNegativeInteger(snapshot.revision) || !Array.isArray(snapshot.messages)) return;
  const messages: ChatMessage[] = [];
  let previousId = 0;
  for (const value of snapshot.messages as unknown[]) {
    const message = record(value);
    if (!message) return;
    const { id, role, text, time, edited } = message;
    const toolCalls = readToolCalls(message.toolCalls);
    if (!nonNegativeInteger(id) || id <= previousId || id >= Number.MAX_SAFE_INTEGER - 1 ||
      (role !== 'user' && role !== 'assistant') || !nonNegativeInteger(time) || time > 8.64e15 ||
      typeof text !== 'string' || !text.isWellFormed() || (!text && !toolCalls?.length) ||
      (message.toolCalls !== undefined && (role !== 'assistant' || !toolCalls)) ||
      (edited !== undefined && typeof edited !== 'boolean')) return;
    messages.push({ id, role, text, time, edited, toolCalls });
    previousId = id;
  }
  return { revision: snapshot.revision, messages };
}

function readToolCalls(value: unknown): ChatToolCall[] | undefined {
  if (!Array.isArray(value) || !value.length) return;
  const calls: ChatToolCall[] = [];
  const ids = new Set<string>();
  for (const raw of value as unknown[]) {
    const call = record(raw);
    if (!call) return;
    const { id, name, arguments: args, result, isError } = call;
    if (!isToolCallId(id) || ids.has(id) || !isToolName(name) || !jsonObject(args) || !jsonValue(result) ||
      (isError !== undefined && typeof isError !== 'boolean')) return;
    calls.push({ id, name, arguments: args, result, isError });
    ids.add(id);
  }
  return calls;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
