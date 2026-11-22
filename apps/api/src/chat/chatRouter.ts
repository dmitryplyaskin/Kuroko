import {
  chatActivityKinds, chatActivityStatuses, chatTitleLimit,
  type ChatActivityEntry, type ChatActivityTurn, type ChatMessage, type ChatSnapshot, type ChatToolCall,
} from '@kuroko/contracts/chat';
import { errorBody } from '@kuroko/contracts/errors';
import { Router } from 'express';
import { jsonObject, jsonValue, record } from '../llm/json';
import { LlmError } from '../llm/llmErrors';
import { isToolCallId, isToolName } from '../llm/readLlmRequest';
import type { createChatStore } from './chatStore';
import { GmReplyError, type createGmReply } from './gmReply';

export function createChatRouter(store: ReturnType<typeof createChatStore>, gmReply: ReturnType<typeof createGmReply>) {
  const router = Router();
  const activeGmTurns = new Set<string>();
  router.get('/', (_request, response) => { response.json(store.list(response.locals.user.id)); });
  router.post('/', (_request, response) => { response.status(201).json(store.create(response.locals.user.id)); });
  router.get('/:id', (request, response) => {
    const chat = store.open(response.locals.user.id, request.params.id);
    if (chat) response.json(chat);
    else response.status(404).json(errorBody('chat_not_found'));
  });
  router.put('/:id/title', (request, response) => {
    const value = record(request.body)?.title;
    const title = typeof value === 'string' ? value.trim() : '';
    if (!title || !title.isWellFormed() || /\p{Cc}/u.test(title) || Array.from(title).length > chatTitleLimit) {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const chat = store.rename(response.locals.user.id, request.params.id, title);
    if (chat) response.json(chat);
    else response.status(404).json(errorBody('chat_not_found'));
  });
  router.delete('/:id', (request, response) => {
    if (store.remove(response.locals.user.id, request.params.id)) response.status(204).end();
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
  router.post('/:id/gm-reply', async (request, response) => {
    const { id } = request.params;
    const userId: number = response.locals.user.id;
    const revision = record(request.body)?.revision;
    if (!nonNegativeInteger(revision)) {
      response.status(400).json(errorBody('invalid_request'));
      return;
    }
    const chat = store.find(userId, id);
    if (!chat) {
      response.status(404).json(errorBody('chat_not_found'));
      return;
    }
    const prompt = chat.messages.at(-1);
    if (!chat.gmMode || chat.revision !== revision || prompt?.role !== 'user' || prompt.id >= Number.MAX_SAFE_INTEGER - 2 ||
        activeGmTurns.has(id)) {
      response.status(409).json(errorBody('chat_conflict'));
      return;
    }

    const controller = new AbortController();
    const disconnect = () => controller.abort();
    const timeout = AbortSignal.timeout(300_000);
    response.once('close', disconnect);
    activeGmTurns.add(id);
    try {
      const result = await gmReply(userId, chat, AbortSignal.any([controller.signal, timeout]));
      if (controller.signal.aborted || response.destroyed) return;
      if (result === 'missing') response.status(404).json(errorBody('chat_not_found'));
      else if (result === 'conflict') response.status(409).json(errorBody('chat_conflict'));
      else response.json(result);
    } catch (error) {
      if (controller.signal.aborted || response.destroyed) return;
      if (error instanceof GmReplyError) response.status(422).json(errorBody(error.code));
      else {
        const failure = timeout.aborted ? new LlmError('timeout') : error instanceof LlmError ? error : new LlmError('internal_error');
        response.status(failure.status).json(failure.body);
      }
    } finally {
      response.off('close', disconnect);
      activeGmTurns.delete(id);
    }
  });
  return router;
}

function readSnapshot(value: unknown): ChatSnapshot | undefined {
  const snapshot = record(value);
  if (!snapshot || !nonNegativeInteger(snapshot.revision) || !Array.isArray(snapshot.messages) ||
      (snapshot.gmMode !== undefined && typeof snapshot.gmMode !== 'boolean')) return;
  const messages: ChatMessage[] = [];
  let previousId = 0;
  for (const value of snapshot.messages as unknown[]) {
    const message = record(value);
    if (!message) return;
    const { id, role, text, time, edited } = message;
    if (!nonNegativeInteger(id) || id <= previousId || id >= Number.MAX_SAFE_INTEGER - 1 ||
      (role !== 'user' && role !== 'assistant') || !nonNegativeInteger(time) || time > 8.64e15 ||
      typeof text !== 'string' || !text.isWellFormed() ||
      (edited !== undefined && typeof edited !== 'boolean')) return;
    const toolCalls = readToolCalls(message.toolCalls, text);
    if ((!text && !toolCalls) || (message.toolCalls !== undefined && (role !== 'assistant' || !toolCalls))) return;
    messages.push({ id, role, text, time, edited, toolCalls });
    previousId = id;
  }
  const activity = readActivity(snapshot.activity, messages);
  if (snapshot.activity !== undefined && !activity) return;
  return { revision: snapshot.revision, messages, gmMode: snapshot.gmMode, activity };
}

function readActivity(value: unknown, messages: ChatMessage[]): ChatActivityTurn | undefined {
  const turn = record(value);
  if (!turn || !nonNegativeInteger(turn.promptId) || !Array.isArray(turn.entries) || !turn.entries.length ||
      !messages.some(({ id, role }) => id === turn.promptId && role === 'user')) return;
  const entries: ChatActivityEntry[] = [];
  const agents = new Set<string>();
  const ids = new Set<string>();
  for (const raw of turn.entries as unknown[]) {
    const entry = record(raw);
    if (!entry) return;
    const { id, kind, status, time, duration, name, agentId, details } = entry;
    if (typeof id !== 'string' || !/^\d+(\/\d+)?$/.test(id) || id.length > 40 || ids.has(id) ||
        typeof kind !== 'string' || !chatActivityKinds.some((value) => value === kind) ||
        typeof status !== 'string' || status === 'running' || !chatActivityStatuses.some((value) => value === status) ||
        !nonNegativeInteger(time) || time > 8.64e15 || (duration !== undefined && !nonNegativeInteger(duration)) ||
        (name !== undefined && (typeof name !== 'string' || !name.isWellFormed() || name.length > 512)) ||
        (agentId !== undefined && (typeof agentId !== 'string' || !agents.has(agentId))) || !jsonObject(details)) return;
    ids.add(id);
    if (kind === 'agent') agents.add(id);
    entries.push({ id, kind: kind as ChatActivityEntry['kind'], status: status as ChatActivityEntry['status'], time, duration, name, agentId, details });
  }
  return { promptId: turn.promptId, entries };
}

function readToolCalls(value: unknown, text: string): ChatToolCall[] | undefined {
  if (!Array.isArray(value) || !value.length) return;
  const calls: ChatToolCall[] = [];
  const ids = new Set<string>();
  let previousOffset = 0;
  for (const raw of value as unknown[]) {
    const call = record(raw);
    if (!call) return;
    const { id, name, arguments: args, result, modelResult, isError, textOffset } = call;
    if (!isToolCallId(id) || ids.has(id) || !isToolName(name) || !jsonObject(args) || !jsonValue(result) ||
      (modelResult !== undefined && !jsonValue(modelResult)) || (isError !== undefined && typeof isError !== 'boolean')) return;
    const offset = textOffset === undefined ? 0 : textOffset;
    if (!nonNegativeInteger(offset) || offset < previousOffset || offset > text.length) return;
    const code = text.charCodeAt(offset);
    if (code >= 0xdc00 && code <= 0xdfff) return;
    previousOffset = offset;
    calls.push({ id, name, arguments: args, result, modelResult, isError, textOffset: textOffset === undefined ? undefined : offset });
    ids.add(id);
  }
  return calls;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
