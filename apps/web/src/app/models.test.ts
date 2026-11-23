import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSettled, createWatch, fork, scopeBind } from 'effector';
import type { ChatMessage, ChatReplyVariantSelection, ChatSnapshot, SavedChat } from '@kuroko/contracts/chat';
import { defaultChatSettings } from '@kuroko/contracts/chatSettings';
import { defaultConnectionSettings, type ConnectionState } from '@kuroko/contracts/connectionSettings';
import { isToolId, type ToolId } from '@kuroko/contracts/tools';
import { appStarted } from '../platform/lifecycle';
import { ApiError } from '../shared/http/api';
import {
  $activeSession, $session, checkSessionFx, protectedRequestFailed, sessionEndRequested, sessionRetryRequested, sessionUserReceived,
} from '../platform/session/model';
import {
  $appliedChatSettings, $chatSettingsDirty, $chatSettingsDraft, $chatSettingsSubmission, chatSettingsChanged,
  chatSettingsInitialized, chatSettingsSaveRequested, loadChatSettingsFx, saveChatSettingsFx,
} from '../features/chat/settings/model';
import {
  $connectionLoad, $connectionSelection, $presetPending, connectionActionRequested, connectionClosed, connectionDraftChanged,
  connectionModelsRequested, connectionOpened, connectionPresetChangeFx, connectionProviderChanged, connectionTabClosed,
  loadConnectionFx, mutateConnectionFx,
} from '../features/connection/model';
import { $modelCatalog, loadModelCatalogFx } from '../features/connection/modelCatalog';
import { $enabledTools, toolsInitialized, toolSettingChanged } from '../features/tools/model';
import {
  $activeSubagents, $chatActivity, $chatAnnouncement, $chatDraft, $chatError, $chatGmMode, $chatId, $chatRegenerateId, $chatReplyVariants,
  $chatRows, $replyId, $replyPhase,
  chatCreateRequested, chatDraftChanged, chatGmModeChanged,
  chatOpenRequested, chatSendRequested, chatShown, chatStopRequested,
  messageDeleteRequested, messageEditChanged, messageEditRequested, messageEditSubmitted, messageRegenerateRequested, replyVariantRequested,
} from '../features/chat/model';

const user = { id: 1, username: 'Лина' };
const noChatSettings = () => ({ settings: null, legacy: undefined });

const connection: ConnectionState = {
  activePresetId: 'one',
  presets: [{
    ...defaultConnectionSettings, id: 'one', name: 'Первый пресет', model: 'demo-model', provider: 'openai', keyId: 'key',
  }],
  keys: [
    { id: 'key', name: 'Первый ключ', provider: 'openai' },
    { id: 'other-key', name: 'Второй ключ', provider: 'anthropic' },
  ],
};

test('startup can retry after a network error and enters the workspace after restoring a session', async () => {
  let attempts = 0;
  const scope = fork({
    handlers: [
      [checkSessionFx, () => {
        if (++attempts === 1) throw new Error('Unavailable');
        return user;
      }],
    ],
  });

  await allSettled(appStarted, { scope });
  assert.equal(scope.getState($session).status, 'unavailable');
  await allSettled(sessionRetryRequested, { scope });
  assert.deepEqual(scope.getState($activeSession)?.user, user);
  await allSettled(sessionRetryRequested, { scope });
  assert.equal(attempts, 2);
});

test('a late 401 after signing in again as the same user leaves the new session intact', async () => {
  const oldSave = Promise.withResolvers<typeof defaultChatSettings>();
  const scope = fork({
    handlers: [[loadChatSettingsFx, noChatSettings], [saveChatSettingsFx, () => oldSave.promise]],
  });

  await allSettled(chatSettingsInitialized, { scope });
  await allSettled(sessionUserReceived, { scope, params: user });
  const oldSession = scope.getState($activeSession)!;
  await allSettled(chatSettingsChanged, { scope, params: { fontSize: 20 } });
  scopeBind(chatSettingsSaveRequested, { scope })();
  assert.equal(scope.getState($chatSettingsSubmission).status, 'saving');
  scopeBind(sessionEndRequested, { scope })({ session: oldSession });
  assert.equal(oldSession.signal.aborted, true);
  assert.deepEqual(scope.getState($chatSettingsDraft), defaultChatSettings);
  scopeBind(sessionUserReceived, { scope })(user);

  oldSave.reject(new ApiError(401, 'auth_required'));
  await allSettled(scope);

  assert.equal(scope.getState($session).status, 'authenticated');
  assert.notEqual(scope.getState($activeSession), oldSession);
  assert.equal(scope.getState($chatSettingsSubmission).status, 'idle');
  assert.deepEqual(scope.getState($appliedChatSettings), defaultChatSettings);

  await allSettled(protectedRequestFailed, {
    scope, params: { session: scope.getState($activeSession)!, error: new ApiError(401, 'auth_required') },
  });
  assert.equal(scope.getState($session).status, 'guest');
});

test('a late successful load leaves the chat settings of a new session for the same user intact', async () => {
  const freshSettings = { ...defaultChatSettings, fontSize: 20 };
  const oldLoad = Promise.withResolvers<Awaited<ReturnType<typeof loadChatSettingsFx>>>();
  let requests = 0;
  const scope = fork({
    handlers: [[loadChatSettingsFx, () => ++requests === 1 ? oldLoad.promise : { settings: freshSettings, legacy: undefined }]],
  });

  await allSettled(chatSettingsInitialized, { scope });
  const signIn = scopeBind(sessionUserReceived, { scope });
  signIn(user);
  const oldSession = scope.getState($activeSession)!;
  scopeBind(sessionEndRequested, { scope })({ session: oldSession });
  signIn(user);
  await Promise.resolve();

  assert.equal(requests, 2);
  assert.equal(oldSession.signal.aborted, true);
  assert.deepEqual(scope.getState($appliedChatSettings), freshSettings);
  oldLoad.resolve({ settings: { ...defaultChatSettings, fontSize: 24 }, legacy: undefined });
  await allSettled(scope);

  assert.deepEqual(scope.getState($appliedChatSettings), freshSettings);
  assert.deepEqual(scope.getState($chatSettingsDraft), freshSettings);
});

test('legacy chat preferences are a draft and are applied only after a successful save', async () => {
  const legacy = { ...defaultChatSettings, fontSize: 22 };
  const saving = Promise.withResolvers<typeof defaultChatSettings>();
  const scope = fork({
    handlers: [
      [loadChatSettingsFx, () => ({ settings: null, legacy })],
      [saveChatSettingsFx, ({ draft }: Parameters<typeof saveChatSettingsFx>[0]) => {
        assert.deepEqual(draft, legacy);
        return saving.promise;
      }],
    ],
  });

  await allSettled(chatSettingsInitialized, { scope });
  await allSettled(sessionUserReceived, { scope, params: user });
  assert.deepEqual(scope.getState($chatSettingsDraft), legacy);
  assert.equal(scope.getState($chatSettingsDirty), true);
  assert.deepEqual(scope.getState($appliedChatSettings), defaultChatSettings);

  scopeBind(chatSettingsSaveRequested, { scope })();
  scopeBind(chatSettingsChanged, { scope })({ fontSize: 25 });
  assert.deepEqual(scope.getState($chatSettingsDraft), legacy);
  saving.resolve(legacy);
  await allSettled(scope);

  assert.equal(scope.getState($chatSettingsDirty), false);
  assert.deepEqual(scope.getState($appliedChatSettings), legacy);
});

test('copying a saved connection keeps the current draft and applying it loads its saved settings', async () => {
  const copy = { ...connection.presets[0]!, id: 'copy', name: 'Копия' };
  const copied = { ...connection, presets: [...connection.presets, copy] };
  const scope = fork({
    handlers: [
      [loadConnectionFx, () => connection],
      [mutateConnectionFx, ({ mutation }: Parameters<typeof mutateConnectionFx>[0]) => {
        assert.equal(mutation.kind, 'managePreset');
        const { action } = mutation;
        if (action.kind === 'apply' && action.id === 'missing') throw new ApiError(404, 'preset_not_found');
        return { kind: 'managePreset', action, state: action.kind === 'copy' ? copied : { ...copied, activePresetId: copy.id } };
      }],
    ],
  });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(connectionOpened, { scope });
  await allSettled(connectionDraftChanged, { scope, params: { model: 'custom-model' } });
  await allSettled(connectionPresetChangeFx, { scope, params: { kind: 'copy', id: 'one', name: 'Копия' } });
  assert.equal(scope.getState($connectionSelection).presetId, 'one');
  assert.equal(scope.getState($connectionSelection).draft.model, 'custom-model');

  const failed = await allSettled(connectionPresetChangeFx, { scope, params: { kind: 'apply', id: 'missing' } });
  assert.equal(failed.status, 'fail');
  assert.equal(scope.getState($connectionSelection).draft.model, 'custom-model');
  await allSettled(connectionPresetChangeFx, { scope, params: { kind: 'apply', id: copy.id } });
  assert.equal(scope.getState($connectionSelection).presetId, copy.id);
  assert.equal(scope.getState($connectionSelection).draft.model, 'demo-model');
});

test('changing provider cancels the old catalog and ignores its late result', async () => {
  const first = Promise.withResolvers<{ models: { id: string }[] }>();
  let firstController: AbortController | undefined;
  const scope = fork({
    handlers: [
      [loadConnectionFx, () => connection],
      [loadModelCatalogFx, ({ provider, controller }: Parameters<typeof loadModelCatalogFx>[0]) => {
        if (provider === 'anthropic') return { models: [{ id: 'current-model' }] };
        firstController = controller;
        return first.promise;
      }],
    ],
  });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(connectionOpened, { scope });
  scopeBind(connectionModelsRequested, { scope })();
  assert.equal(scope.getState($modelCatalog).status, 'loading');

  scopeBind(connectionProviderChanged, { scope })('anthropic');
  assert.equal(firstController?.signal.aborted, true);
  assert.equal(scope.getState($modelCatalog).status, 'idle');
  scopeBind(connectionDraftChanged, { scope })({ keyId: 'other-key' });
  scopeBind(connectionModelsRequested, { scope })();

  first.resolve({ models: [{ id: 'stale-model' }] });
  await allSettled(scope);
  assert.deepEqual(scope.getState($modelCatalog), { status: 'ready', models: [{ id: 'current-model' }] });
});

test('re-entering settings waits for a connection write before loading its new snapshot', async () => {
  const saved = { ...connection, presets: connection.presets.map((preset) => ({ ...preset, model: 'saved-model' })) };
  const pending = Promise.withResolvers<ConnectionState>();
  let reads = 0;
  let writes = 0;
  const scope = fork({
    handlers: [
      [loadConnectionFx, () => ++reads === 1 ? connection : saved],
      [mutateConnectionFx, async () => {
        writes++;
        return { kind: 'savePreset', id: 'one', state: await pending.promise };
      }],
    ],
  });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(connectionOpened, { scope });
  void scopeBind(connectionPresetChangeFx, { scope })({ kind: 'update', id: 'one' });
  scopeBind(connectionActionRequested, { scope })({ kind: 'deleteKey', id: 'key' });
  scopeBind(connectionClosed, { scope })();
  scopeBind(connectionOpened, { scope })();

  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.equal(scope.getState($connectionLoad).status, 'loading');
  pending.resolve(saved);
  await allSettled(scope);

  assert.equal(reads, 2);
  assert.deepEqual(scope.getState($connectionLoad), { status: 'ready', data: saved });
  assert.equal(scope.getState($connectionSelection).draft.model, 'saved-model');
});

test('a write finished after switching tabs updates connection data without restoring the old form state', async () => {
  const saved = { ...connection, presets: connection.presets.map((preset) => ({ ...preset, model: 'saved-model' })) };
  const pending = Promise.withResolvers<ConnectionState>();
  const scope = fork({
    handlers: [
      [loadConnectionFx, () => connection],
      [mutateConnectionFx, async () => ({ kind: 'savePreset', id: 'one', state: await pending.promise })],
    ],
  });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(connectionOpened, { scope });
  scopeBind(connectionDraftChanged, { scope })({ model: 'draft-model' });
  void scopeBind(connectionPresetChangeFx, { scope })({ kind: 'update', id: 'one' });
  scopeBind(connectionTabClosed, { scope })();
  assert.equal(scope.getState($connectionSelection).draft.model, 'demo-model');

  pending.resolve(saved);
  await allSettled(scope);
  assert.equal(scope.getState($connectionSelection).draft.model, 'saved-model');
  assert.equal(scope.getState($presetPending), false);
});

const sseHeaders = { 'Content-Type': 'text/event-stream' };
const encode = (text: string) => new TextEncoder().encode(text);
const sse = (value: object) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const completed = (text: string, reasoning?: string) => sse({
  type: 'done', completion: { message: { role: 'assistant', parts: [{ type: 'text', text }] }, finishReason: 'stop', reasoning },
});

async function openChat() {
  const scope = fork();
  await allSettled(toolsInitialized, { scope });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(chatShown, { scope });
  return scope;
}

function withSavedChats(generate: typeof fetch, publishScene?: (chat: SavedChat) => Promise<string>): typeof fetch {
  const chats: SavedChat[] = [];
  const enabled = new Set<ToolId>();
  const replyVersions = new Map<string, ChatMessage[]>();
  function keepVariant(chat: SavedChat, saved: SavedChat, replaceId?: number) {
    if (replaceId === undefined) return saved;
    const key = `${chat.id}/${replaceId}`;
    const versions = replyVersions.get(key) ?? [chat.messages.at(-1)!];
    versions.push(saved.messages.at(-1)!);
    replyVersions.set(key, versions);
    return { ...saved, replyVariants: { ...chat.replyVariants, [replaceId]: { index: versions.length - 1, total: versions.length } } };
  }
  return async (input, init) => {
    if (input === '/api/settings/tools') return Response.json({ enabled: [...enabled] });
    if (typeof input === 'string' && input.startsWith('/api/settings/tools/')) {
      const id = input.split('/').at(-1);
      assert.ok(isToolId(id));
      assert.equal(init?.method, 'PUT');
      if (JSON.parse(String(init.body)).enabled) enabled.add(id);
      else enabled.delete(id);
      return Response.json({ enabled: [...enabled] });
    }
    if (input === '/api/chats') {
      if (init?.method === 'GET') return Response.json(chats.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })));
      assert.equal(init?.method, 'POST');
      const chat = { id: String(chats.length + 1), title: '', updatedAt: Date.now(), revision: 0, messages: [], gmMode: false };
      chats.unshift(chat);
      return Response.json(chat, { status: 201 });
    }
    if (typeof input === 'string' && input.startsWith('/api/chats/')) {
      const gmReply = input.endsWith('/gm-reply');
      const selectVariant = input.endsWith('/reply-variant');
      const path = gmReply || selectVariant ? input.slice(0, input.lastIndexOf('/')) : input;
      const index = chats.findIndex((chat) => `/api/chats/${chat.id}` === path);
      assert.ok(index >= 0);
      const chat = chats[index]!;
      if (gmReply) {
        assert.ok(chat.gmMode && publishScene);
        assert.equal(init?.method, 'POST');
        const { revision, replaceId } = JSON.parse(String(init.body));
        assert.equal(revision, chat.revision);
        if (replaceId !== undefined) assert.equal(replaceId, chat.messages.at(-1)?.id);
        const messages = replaceId === undefined ? chat.messages : chat.messages.slice(0, -1);
        const text = await publishScene({ ...chat, messages });
        const message = { id: messages.at(-1)!.id + 1, role: 'assistant' as const, text, time: Date.now() };
        const saved = keepVariant(chat, { ...chat, revision: chat.revision + 1, messages: [...messages, message] }, replaceId);
        chats[index] = saved;
        return Response.json(saved);
      }
      if (selectVariant) {
        assert.equal(init?.method, 'PUT');
        const { revision, replyId, index: selected } = JSON.parse(String(init.body)) as ChatReplyVariantSelection & { revision: number };
        const versions = replyVersions.get(`${chat.id}/${replyId}`);
        assert.equal(revision, chat.revision);
        assert.ok(versions?.[selected]);
        const messages = chat.messages.map((message) => message.id === replyId ? versions[selected]! : message);
        const replyVariants = { ...chat.replyVariants, [replyId]: { index: selected, total: versions.length } };
        const saved = { ...chat, revision: revision + 1, messages, replyVariants };
        chats[index] = saved;
        return Response.json(saved);
      }
      if (init?.method === 'GET') return Response.json(chat);
      assert.equal(init?.method, 'PUT');
      const { revision, messages, gmMode, replaceId } = JSON.parse(String(init.body)) as ChatSnapshot;
      assert.equal(revision, chat.revision);
      const saved = keepVariant(chat, { ...chat, revision: revision + 1, messages, gmMode: gmMode ?? chat.gmMode }, replaceId);
      chats[index] = saved;
      return Response.json(saved);
    }
    return generate(input, init);
  };
}

test('GM chat uses the server publication and restores its mode without re-saving the response', async () => {
  const originalFetch = globalThis.fetch;
  const waiting = Promise.withResolvers<void>();
  const scene = Promise.withResolvers<string>();
  const revisions: number[] = [];
  globalThis.fetch = withSavedChats(async () => {
    assert.fail('GM chat must not call the browser generation endpoint');
  }, async (chat) => {
    revisions.push(chat.revision);
    waiting.resolve();
    if (revisions.length === 2) {
      assert.deepEqual(chat.messages.map(({ text }) => text), ['Осматриваю ворота']);
      return 'Ворота заперты.';
    }
    return scene.promise;
  });
  const scope = await openChat();
  try {
    assert.equal(scope.getState($chatGmMode), false);
    await allSettled(toolSettingChanged, { scope, params: { id: 'test_echo', enabled: true } });
    await allSettled(chatGmModeChanged, { scope, params: true });
    assert.equal(scope.getState($chatGmMode), true);

    await allSettled(chatDraftChanged, { scope, params: 'Осматриваю ворота' });
    scopeBind(chatSendRequested, { scope })();
    await waiting.promise;
    assert.notEqual(scope.getState($replyId), null);
    assert.deepEqual(scope.getState($chatRows).map(({ text, toolCalls }) => [text, toolCalls]), [
      ['Осматриваю ворота', undefined], ['', undefined],
    ]);
    scene.resolve('Ворота приоткрыты.');
    await allSettled(scope);
    assert.equal(scope.getState($chatError), null);
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Осматриваю ворота', 'Ворота приоткрыты.']);
    await allSettled(messageRegenerateRequested, { scope, params: 2 });
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Осматриваю ворота', 'Ворота заперты.']);
    assert.deepEqual(scope.getState($chatReplyVariants), { 2: { index: 1, total: 2 } });

    const id = scope.getState($chatId);
    await allSettled(chatCreateRequested, { scope });
    assert.equal(scope.getState($chatGmMode), false);
    await allSettled(chatOpenRequested, { scope, params: id });
    assert.equal(scope.getState($chatGmMode), true);
    assert.equal(scope.getState($chatRows).at(-1)?.text, 'Ворота заперты.');
    await allSettled(chatDraftChanged, { scope, params: 'Заглядываю внутрь' });
    await allSettled(chatSendRequested, { scope });
    assert.deepEqual(revisions, [2, 3, 5]);
  } finally {
    scene.resolve('');
    globalThis.fetch = originalFetch;
  }
});

test('chat streams reasoning separately, restores it, and sends the selected conversation history', async () => {
  const payloads: unknown[] = [];
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = withSavedChats(async (input, init) => {
    assert.equal(input, '/api/llm/generate');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Accept'), 'text/event-stream');
    assert.equal(headers.get('X-Kuroko-Request'), '1');
    assert.equal(headers.get('X-Kuroko-Account'), String(user.id));
    payloads.push(JSON.parse(String(init?.body)));
    return new Response(payloads.length === 1 ? stream.readable : completed('Второй ответ.'), { headers: sseHeaders });
  });
  const scope = await openChat();
  const partial = Promise.withResolvers<void>();
  const thinking = Promise.withResolvers<void>();
  const unwatch = createWatch({
    scope, unit: $chatRows, fn: (rows) => {
      if (rows.at(-1)?.reasoningBlocks?.[0]?.text === 'Начинаю с приветствия.') thinking.resolve();
      if (rows.at(-1)?.text === 'При') partial.resolve();
    },
  });
  try {
    assert.deepEqual(scope.getState($chatRows), []);
    await allSettled(chatDraftChanged, { scope, params: '  Привет  ' });
    scopeBind(chatSendRequested, { scope })();
    await writer.write(encode(sse({ type: 'reasoning_delta', text: 'Начинаю с приветствия.' })));
    await thinking.promise;
    assert.equal(scope.getState($replyPhase), 'reasoning');
    assert.equal(scope.getState($chatRows).at(-1)?.text, '');
    const bytes = encode(': ping\r\n\r\n' + sse({ type: 'text_delta', text: 'При' }));
    const split = bytes.findIndex((byte) => byte > 127) + 1;
    await writer.write(bytes.subarray(0, split));
    await writer.write(bytes.subarray(split));
    await partial.promise;
    assert.notEqual(scope.getState($replyId), null);
    assert.equal(scope.getState($replyPhase), 'answer');
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Привет', 'При']);

    await writer.write(encode(completed('Привет!', 'Начинаю с приветствия.')));
    void writer.close().catch(() => undefined);
    await allSettled(scope);
    assert.equal(scope.getState($replyId), null);
    const first = scope.getState($chatId);
    await allSettled(chatCreateRequested, { scope });
    const second = scope.getState($chatId);
    assert.notEqual(first, second);
    assert.deepEqual(scope.getState($chatRows), []);
    const reloaded = await openChat();
    assert.equal(reloaded.getState($chatId), second);
    await allSettled(chatOpenRequested, { scope: reloaded, params: first });
    assert.deepEqual(reloaded.getState($chatRows).map(({ text }) => text), ['Привет', 'Привет!']);
    assert.deepEqual(reloaded.getState($chatRows).at(-1)?.reasoningBlocks, [{ text: 'Начинаю с приветствия.', textOffset: 0 }]);
    await allSettled(chatDraftChanged, { scope: reloaded, params: 'Второй запрос' });
    await allSettled(chatSendRequested, { scope: reloaded });
    assert.deepEqual(reloaded.getState($chatRows).map(({ text }) => text), ['Привет', 'Привет!', 'Второй запрос', 'Второй ответ.']);
    assert.deepEqual(payloads, [
      { stream: true, includeReasoning: true, messages: [{ role: 'user', content: 'Привет' }] },
      { stream: true, includeReasoning: true, messages: [
        { role: 'user', content: 'Привет' }, { role: 'assistant', parts: [{ type: 'text', text: 'Привет!' }] },
        { role: 'user', content: 'Второй запрос' },
      ] },
    ]);
    await allSettled(chatOpenRequested, { scope: reloaded, params: second });
    assert.deepEqual(reloaded.getState($chatRows), []);
  } finally {
    unwatch();
    globalThis.fetch = originalFetch;
    void writer.abort().catch(() => undefined);
  }
});

test('chat regenerates only the last turn and keeps the previous answer if the replacement fails or stops', async () => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  const waiting = Promise.withResolvers<void>();
  globalThis.fetch = withSavedChats(async (input, init) => {
    assert.equal(input, '/api/llm/generate');
    requests.push(JSON.parse(String(init?.body)).messages);
    const error = { type: 'error', code: 'provider_unavailable' };
    if (requests.length === 2) return new Response(sse(error), { headers: sseHeaders });
    if (requests.length === 4) return new Response(sse({ type: 'text_delta', text: 'Черновик' }) + sse(error), { headers: sseHeaders });
    if (requests.length === 5) return new Promise((_, reject) => {
      const signal = init!.signal!;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      waiting.resolve();
    });
    const text = requests.length === 1 ? 'Первый ответ' : requests.length === 3 ? 'Исходный ответ' : 'Новый ответ';
    return new Response(completed(text), { headers: sseHeaders });
  });
  const scope = await openChat();
  const regenerate = (id: number) => allSettled(messageRegenerateRequested, { scope, params: id });
  try {
    await allSettled(chatDraftChanged, { scope, params: 'Первый запрос' });
    await allSettled(chatSendRequested, { scope });
    await allSettled(chatDraftChanged, { scope, params: 'Второй запрос' });
    await allSettled(chatSendRequested, { scope });
    await allSettled(chatDraftChanged, { scope, params: 'Несохранённый черновик' });
    assert.equal(scope.getState($chatRegenerateId), 3);
    await regenerate(2);
    assert.equal(requests.length, 2);
    await regenerate(3);
    assert.equal(scope.getState($chatError), null);
    assert.equal(scope.getState($chatRegenerateId), 4);
    const original = scope.getState($chatRows);
    const activity = scope.getState($chatActivity);
    assert.equal(original.at(-1)?.text, 'Исходный ответ');

    await regenerate(4);
    assert.equal(scope.getState($chatError), 'provider_unavailable');
    assert.deepEqual(scope.getState($chatRows), original);
    assert.deepEqual(scope.getState($chatActivity), activity);

    scopeBind(messageRegenerateRequested, { scope })(4);
    await waiting.promise;
    assert.equal(scope.getState($chatRegenerateId), null);
    assert.equal(scope.getState($chatRows).at(-1)?.text, '');
    await allSettled(chatStopRequested, { scope });
    assert.deepEqual(scope.getState($chatRows), original);
    assert.deepEqual(scope.getState($chatActivity), activity);

    await regenerate(4);
    assert.deepEqual(scope.getState($chatRows).map(({ id, text }) => [id, text]), [
      [1, 'Первый запрос'], [2, 'Первый ответ'], [3, 'Второй запрос'], [4, 'Новый ответ'],
    ]);
    assert.deepEqual(scope.getState($chatActivity).map(({ promptId }) => promptId), [1, 3]);
    assert.equal(scope.getState($chatDraft), 'Несохранённый черновик');
    const history = [
      { role: 'user', content: 'Первый запрос' }, { role: 'assistant', parts: [{ type: 'text', text: 'Первый ответ' }] },
      { role: 'user', content: 'Второй запрос' },
    ];
    assert.deepEqual(requests.slice(1), Array.from({ length: 5 }, () => history));
    assert.deepEqual(scope.getState($chatReplyVariants), { 4: { index: 1, total: 2 } });
    await allSettled(replyVariantRequested, { scope, params: { replyId: 4, index: 0 } });
    assert.deepEqual(scope.getState($chatRows), original);
    const reloaded = await openChat();
    assert.deepEqual(reloaded.getState($chatRows), original);
    assert.deepEqual(reloaded.getState($chatReplyVariants), { 4: { index: 0, total: 2 } });
    await allSettled(chatDraftChanged, { scope: reloaded, params: 'Продолжай' });
    await allSettled(chatSendRequested, { scope: reloaded });
    assert.deepEqual(requests.at(-1), [
      ...history, { role: 'assistant', parts: [{ type: 'text', text: 'Исходный ответ' }] }, { role: 'user', content: 'Продолжай' },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat stops the request, retains the visible answer and ignores late frames', async () => {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = withSavedChats(async (_input, init) => {
    signal = init?.signal;
    return new Response(stream.readable, { headers: sseHeaders });
  });
  const scope = await openChat();
  const partial = Promise.withResolvers<void>();
  const unwatch = createWatch({
    scope, unit: $chatRows, fn: (rows) => { if (rows.at(-1)?.text === 'Начало') partial.resolve(); },
  });
  try {
    await allSettled(chatDraftChanged, { scope, params: 'Привет' });
    scopeBind(chatSendRequested, { scope })();
    await writer.write(encode(sse({ type: 'text_delta', text: 'Начало' })));
    await partial.promise;
    scopeBind(chatStopRequested, { scope })();
    assert.equal(signal?.aborted, true);
    assert.equal(scope.getState($replyId), null);
    assert.equal(scope.getState($chatAnnouncement), 'chat.announcementStopped');

    await writer.write(encode(sse({ type: 'text_delta', text: ' и продолжение' }) + completed('Поздний ответ')));
    void writer.close().catch(() => undefined);
    await allSettled(scope);
    assert.equal(scope.getState($chatRows).at(-1)?.text, 'Начало');
    assert.equal(scope.getState($chatError), null);
    const message = scope.getState($chatRows)[0]!;
    await allSettled(messageEditRequested, { scope, params: message.id });
    await allSettled(messageEditChanged, { scope, params: { id: message.id, text: '  Правка  ' } });
    await allSettled(messageEditSubmitted, { scope, params: message.id });
    assert.partialDeepStrictEqual(scope.getState($chatRows)[0], { text: 'Правка', edited: true });
    await allSettled(messageDeleteRequested, { scope, params: message.id });
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Начало']);
    const reloaded = await openChat();
    assert.deepEqual(reloaded.getState($chatRows).map(({ text }) => text), ['Начало']);
  } finally {
    unwatch();
    globalThis.fetch = originalFetch;
    void writer.abort().catch(() => undefined);
  }
});

test('chat displays connection and stream errors and keeps partial text', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = withSavedChats(async () => {
    if (++requests === 1) return Response.json({ code: 'missing_preset' }, { status: 404 });
    if (requests === 3) return new Response(sse({
      type: 'done', completion: { message: { role: 'assistant', parts: [{ type: 'text', text: 'Текст до лимита' }] }, finishReason: 'length' },
    }), { headers: sseHeaders });
    return new Response(sse({ type: 'text_delta', text: 'Начало' }) +
      sse({ type: 'error', code: 'provider_unavailable' }), { headers: sseHeaders });
  });
  const scope = await openChat();
  try {
    await allSettled(chatDraftChanged, { scope, params: 'Первое сообщение' });
    await allSettled(chatSendRequested, { scope });
    assert.equal(scope.getState($chatError), 'missing_preset');
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Первое сообщение']);
    await allSettled(chatDraftChanged, { scope, params: 'Второе сообщение' });
    await allSettled(chatSendRequested, { scope });
    assert.equal(scope.getState($chatError), 'provider_unavailable');
    assert.equal(scope.getState($chatRows).at(-1)?.text, 'Начало');
    await allSettled(chatDraftChanged, { scope, params: 'Третье сообщение' });
    await allSettled(chatSendRequested, { scope });
    assert.equal(scope.getState($chatError), 'response_length');
    const reloaded = await openChat();
    assert.equal(reloaded.getState($chatRows).at(-1)?.text, 'Текст до лимита');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat starts a new reasoning block after a tool batch and preserves its position', async () => {
  const originalFetch = globalThis.fetch;
  const presetId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const prompt = { role: 'user', content: 'Проведи боевой раунд' };
  const initiative = 'Бросаю инициативу. 🎲';
  const waitText = ' Смотрю результат.';
  const attack = 'Морвен ходит первой, бросаю атаку.';
  const roll = (text: string, expression: string) => ({
    role: 'assistant', parts: [
      { type: 'text', text },
      { type: 'toolCall', id: 'call_same', name: 'roll_dice', arguments: { rolls: { total: expression } } },
    ],
  });
  const first = roll(initiative, 'd1 + 6');
  first.parts.push({ type: 'text', text: waitText });
  const second = roll(attack, 'd1 + 16');
  const result = (total: number, rollId: string) => ({ role: 'tool', callId: 'call_same', content: { rollId, values: { total } } });
  const toolDone = (message: typeof first, reasoning: string) =>
    sse({ type: 'done', completion: { presetId, message, finishReason: 'tool_calls', reasoning } });
  const continuation = new TransformStream<Uint8Array, Uint8Array>();
  const writer = continuation.writable.getWriter();
  let requests = 0;
  globalThis.fetch = withSavedChats(async (input, init) => {
    assert.equal(input, '/api/llm/generate');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.tools.map(({ name }: { name: string }) => name), ['roll_dice']);
    if (++requests === 1) {
      assert.deepEqual(body.messages, [prompt]);
      return new Response(sse({ type: 'reasoning_delta', text: 'Определю порядок ходов.' }) +
        sse({ type: 'text_delta', text: initiative + waitText }) + toolDone(first, 'Определю порядок ходов.'), { headers: sseHeaders });
    }
    assert.equal(body.presetId, presetId);
    assert.equal(body.toolChoice, 'auto');
    const expected = [prompt, first, result(7, 'call_same')];
    if (requests === 2) {
      assert.deepEqual(body.messages, expected);
      return new Response(continuation.readable, { headers: sseHeaders });
    }
    assert.equal(requests, 3);
    const recordId = body.messages[4].content.rollId;
    assert.notEqual(recordId, 'call_same');
    assert.deepEqual(body.messages, [...expected, second, result(17, recordId)]);
    return new Response(completed('Атака попала.'), { headers: sseHeaders });
  });
  const scope = await openChat();
  const secondThinking = Promise.withResolvers<void>();
  const unwatch = createWatch({ scope, unit: $chatRows, fn: (rows) => {
    if (rows.at(-1)?.reasoningBlocks?.at(-1)?.text === 'Сравню') secondThinking.resolve();
  } });
  try {
    await allSettled(toolSettingChanged, { scope, params: { id: 'roll_dice', enabled: true } });
    await allSettled(chatDraftChanged, { scope, params: prompt.content });
    scopeBind(chatSendRequested, { scope })();
    await writer.write(encode(sse({ type: 'reasoning_delta', text: 'Сравню' })));
    await secondThinking.promise;
    assert.equal(scope.getState($replyPhase), 'reasoning');
    const firstRound = initiative + waitText;
    const firstReasoning = { text: 'Определю порядок ходов.', textOffset: 0 };
    const secondReasoning = { text: 'Сравню', afterToolCallId: 'call_same', textOffset: firstRound.length };
    assert.deepEqual(scope.getState($chatRows).at(-1)?.reasoningBlocks, [firstReasoning, secondReasoning]);
    await writer.write(encode(sse({ type: 'reasoning_delta', text: ' инициативу.' }) +
      sse({ type: 'text_delta', text: attack }) + toolDone(second, 'Сравню инициативу.')));
    void writer.close().catch(() => undefined);
    await allSettled(scope);
    assert.equal(requests, 3);
    assert.equal(scope.getState($chatError), null);
    const reloaded = await openChat();
    const answer = reloaded.getState($chatRows).at(-1);
    assert.equal(answer?.text, `${firstRound}\n\n${attack}\n\nАтака попала.`);
    assert.deepEqual(answer.reasoningBlocks, [firstReasoning, { ...secondReasoning, text: 'Сравню инициативу.' }]);
    assert.deepEqual(answer.toolCalls?.map(({ textOffset }) => textOffset), [initiative.length, firstRound.length + 2 + attack.length]);
    assert.equal(new Set(answer.toolCalls?.map(({ id }) => id)).size, 2);

    const updatedWait = ' Проверяю бросок.';
    await allSettled(messageEditRequested, { scope: reloaded, params: answer.id });
    await allSettled(messageEditChanged, { scope: reloaded, params: { id: answer.id, index: 1, text: updatedWait } });
    await allSettled(messageEditSubmitted, { scope: reloaded, params: answer.id });
    const edited = reloaded.getState($chatRows).at(-1);
    assert.equal(edited?.text, `${initiative}${updatedWait}\n\n${attack}\n\nАтака попала.`);
    assert.equal(edited?.reasoningBlocks?.[1]?.textOffset, initiative.length + updatedWait.length);
  } finally {
    unwatch();
    globalThis.fetch = originalFetch;
    void writer.abort().catch(() => undefined);
  }
});

test('chat runs named subagents in parallel and restores their separate histories after reopening', async () => {
  const originalFetch = globalThis.fetch;
  const presetId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const agents = [
    { id: 'chronology', name: 'Хронолог', task: 'Проверь хронологию.', answer: 'Хронология последовательна.' },
    { id: 'dialogue', name: 'Редактор', task: 'Проверь диалоги.', answer: 'Вторая реплика длинная.' },
  ];
  const followUp = { name: 'хронолог', task: 'Уточни порядок событий.' };
  const followUpAnswer = 'Сначала утро, затем вечер.';
  const calls = agents.map(({ id, name, task }) => ({ type: 'toolCall', id, name: 'delegate_task', arguments: { name, task } }));
  const results = agents.map(({ id, name, answer }) => ({ role: 'tool', callId: id, content: { answer, name } }));
  const first = agents[0]!;
  const workers = new Map(agents.map(({ name }) => [name, Promise.withResolvers<Response>()]));
  const started: string[] = [];
  const waiting = Promise.withResolvers<void>();
  const toolReply = (...parts: object[]) => new Response(sse({ type: 'done', completion: {
    presetId, message: { role: 'assistant', parts }, finishReason: 'tool_calls',
  } }), { headers: sseHeaders });
  let rounds = 0;
  globalThis.fetch = withSavedChats(async (input, init) => {
    const body = JSON.parse(String(init?.body));
    if (input === '/api/llm/delegate') {
      assert.equal(init?.method, 'POST');
      if (body.task === followUp.task) {
        assert.deepEqual(body, { ...followUp, history: [{ task: first.task, answer: first.answer }] });
        return Response.json({ result: { answer: followUpAnswer, name: followUp.name } });
      }
      const agent = agents.find(({ name }) => name === body.name)!;
      assert.deepEqual(body, { name: agent.name, task: agent.task });
      started.push(agent.name);
      waiting.resolve();
      return workers.get(agent.name)!.promise;
    }
    assert.equal(input, '/api/llm/generate');
    switch (++rounds) {
      case 1:
        assert.deepEqual(body.tools.map(({ name }: { name: string }) => name), ['delegate_task']);
        return toolReply(...calls, { ...calls[0], id: 'duplicate', arguments: { ...followUp } });
      case 2:
        assert.equal(body.presetId, presetId);
        assert.deepEqual(body.messages.slice(-3, -1), results);
        assert.equal(body.messages.at(-1).isError, true);
        return new Response(completed('Порядок сцен верный.'), { headers: sseHeaders });
      case 3:
        return toolReply({ ...calls[0], arguments: followUp });
      case 4:
        assert.deepEqual(body.messages.at(-1), { role: 'tool', callId: first.id, content: { answer: followUpAnswer, name: followUp.name } });
        return new Response(completed(followUpAnswer), { headers: sseHeaders });
      default:
        assert.fail('Unexpected main model request');
    }
  });
  try {
    const scope = await openChat();
    await allSettled(toolSettingChanged, { scope, params: { id: 'delegate_task', enabled: true } });
    await allSettled(chatDraftChanged, { scope, params: 'Проверь порядок сцен.' });
    const sending = allSettled(chatSendRequested, { scope });
    await Promise.race([waiting.promise, sending]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(rounds, 1);
    assert.deepEqual(started, agents.map(({ name }) => name));
    assert.deepEqual(scope.getState($activeSubagents), agents.map(({ id, name }) => ({ id, name })));
    assert.equal(scope.getState($replyPhase), 'subagent');
    assert.equal(scope.getState($chatAnnouncement), 'chat.subagentsWorking');
    workers.get(first.name)!.resolve(Response.json({ result: { answer: first.answer, name: first.name } }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(rounds, 1);
    assert.deepEqual(scope.getState($activeSubagents).map(({ name }) => name), [agents[1]!.name]);
    for (const { name, answer } of agents.slice(1)) workers.get(name)!.resolve(Response.json({ result: { answer, name } }));
    await sending;
    assert.equal(scope.getState($replyPhase), null);
    const reloaded = await openChat();
    assert.equal(reloaded.getState($chatRows).at(-1)?.text, 'Порядок сцен верный.');
    await allSettled(chatDraftChanged, { scope: reloaded, params: 'Вернись к Хронологу.' });
    await allSettled(chatSendRequested, { scope: reloaded });
    assert.equal(reloaded.getState($chatRows).at(-1)?.text, followUpAnswer);
    assert.equal(rounds, 4);
  } finally {
    for (const { name, answer } of agents) workers.get(name)!.resolve(Response.json({ result: { answer, name } }));
    globalThis.fetch = originalFetch;
  }
});

test('account tool settings control chat declarations and keep full dice traces in saved history', async () => {
  const originalFetch = globalThis.fetch;
  const presetId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const echoArgs = { text: 'Проверка 🐸' };
  const echo = { type: 'toolCall', id: 'echo-1', name: 'test_echo', arguments: echoArgs };
  const dice = { type: 'toolCall', id: 'dice-1', name: 'roll_dice', arguments: { sides: 20 } };
  const invalid = { ...dice, id: 'dice-2', arguments: { sides: 0 } };
  const batch = { ...dice, id: 'dice-3', arguments: { purpose: 'Проверка', rolls: { base: 'd1', total: 'if($base == 1,$base + 4,d20)' } } };
  const intro = 'Проверю инструменты. 🎲';
  const between = 'Теперь броски.';
  const editedIntro = 'Проверю ещё раз. 🐸';
  const editedBetween = 'Теперь повторю броски.';
  const toolRequest = {
    role: 'assistant', parts: [{ type: 'text', text: intro }, echo, { type: 'text', text: between }, dice, invalid, batch],
    openrouterReasoning: [{ type: 'reasoning.encrypted', data: 'signed-data' }],
  };
  const prompt = { role: 'user', content: 'Вызови test_echo и брось кубики' };
  const followUp = { role: 'user', content: 'Что выпало на d20?' };
  let roll = 0;
  let requests = 0;
  globalThis.fetch = withSavedChats(async (input, init) => {
    assert.equal(input, '/api/llm/generate');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    requests++;
    if (requests === 3) {
      assert.deepEqual(body.tools.map(({ name }: { name: string }) => name), ['roll_dice']);
      assert.deepEqual(body.messages[0], prompt);
      const previousText = body.messages[1].parts[0].text as string;
      const ordered = [editedIntro, 'test_echo', editedBetween, `roll_dice({"sides":20}) returned {"rollId":"dice-1","sides":20,"roll":${roll}}`, 'Готово'];
      let position = -1;
      for (const fragment of ordered) {
        const next = previousText.indexOf(fragment);
        assert.ok(next > position, fragment);
        position = next;
      }
      assert.ok(body.messages[1].parts[0].text.includes('returned {"rollId":"dice-3","values":{"base":1,"total":5}}'));
      assert.ok(!body.messages[1].parts[0].text.includes('schemaVersion'));
      assert.deepEqual(body.messages[2], followUp);
      return new Response(completed(`${roll}`), { headers: sseHeaders });
    }
    assert.deepEqual(body.tools.map(({ name }: { name: string }) => name), ['roll_dice', 'test_echo']);
    if (requests === 1) {
      assert.deepEqual(body.messages, [prompt]);
      assert.equal(body.presetId, undefined);
      return new Response(sse({ type: 'text_delta', text: intro }) + sse({ type: 'text_delta', text: between }) + sse({
        type: 'done', completion: { presetId, message: toolRequest, finishReason: 'tool_calls' },
      }), { headers: sseHeaders });
    }
    assert.equal(body.presetId, presetId);
    assert.equal(body.toolChoice, 'auto');
    const [, , echoResult, diceResult, invalidResult, batchResult] = body.messages;
    roll = diceResult.content.roll;
    assert.ok(Number.isInteger(roll) && roll >= 1 && roll <= 20);
    assert.deepEqual(body.messages.slice(0, 2), [prompt, toolRequest]);
    assert.deepEqual(echoResult, { role: 'tool', callId: echo.id, content: echoArgs });
    assert.deepEqual(diceResult, { role: 'tool', callId: dice.id, content: { rollId: dice.id, sides: 20, roll } });
    assert.deepEqual(invalidResult, { role: 'tool', callId: invalid.id, content: 'Set sides to an integer between 2 and 1000.', isError: true });
    assert.deepEqual(batchResult, { role: 'tool', callId: batch.id, content: { rollId: batch.id, values: { base: 1, total: 5 } } });
    return new Response(completed('Готово'), { headers: sseHeaders });
  });
  try {
    const scope = await openChat();
    assert.deepEqual(scope.getState($enabledTools), []);
    await allSettled(toolSettingChanged, { scope, params: { id: 'roll_dice', enabled: true } });
    await allSettled(toolSettingChanged, { scope, params: { id: 'test_echo', enabled: true } });
    await allSettled(chatDraftChanged, { scope, params: prompt.content });
    await allSettled(chatSendRequested, { scope });
    assert.equal(requests, 2);
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), [prompt.content, `${intro}${between}\n\nГотово`]);
    const reloaded = await openChat();
    assert.deepEqual(reloaded.getState($enabledTools), ['roll_dice', 'test_echo']);
    const toolCalls = reloaded.getState($chatRows).at(-1)?.toolCalls;
    assert.partialDeepStrictEqual(toolCalls?.slice(0, 3), [
      { id: echo.id, name: echo.name, arguments: echo.arguments, result: echoArgs, textOffset: intro.length },
      { id: dice.id, name: dice.name, arguments: dice.arguments, result: { rollId: dice.id, sides: 20, roll }, textOffset: intro.length + between.length },
      { id: invalid.id, name: invalid.name, arguments: invalid.arguments, result: 'Set sides to an integer between 2 and 1000.', isError: true,
        textOffset: intro.length + between.length },
    ]);
    assert.partialDeepStrictEqual(toolCalls?.[3], {
      id: batch.id, textOffset: intro.length + between.length,
      result: { schemaVersion: 3, purpose: 'Проверка', values: { base: 1, total: 5 }, details: [{ dice: [{ results: [1] }] }] },
      modelResult: { rollId: batch.id, values: { base: 1, total: 5 } },
    });
    const id = reloaded.getState($chatRows).at(-1)!.id;
    await allSettled(messageEditRequested, { scope: reloaded, params: id });
    await allSettled(messageEditChanged, { scope: reloaded, params: { id, index: 0, text: `  ${editedIntro}` } });
    await allSettled(messageEditChanged, { scope: reloaded, params: { id, index: 1, text: editedBetween } });
    await allSettled(messageEditSubmitted, { scope: reloaded, params: id });
    const afterEdit = await openChat();
    const updated = afterEdit.getState($chatRows).at(-1)!;
    assert.equal(updated.text, `${editedIntro}${editedBetween}\n\nГотово`);
    assert.equal(updated.edited, true);
    assert.deepEqual(updated.toolCalls?.map(({ textOffset }) => textOffset), [
      editedIntro.length, ...Array(3).fill(editedIntro.length + editedBetween.length),
    ]);
    await allSettled(toolSettingChanged, { scope: afterEdit, params: { id: 'test_echo', enabled: false } });
    await allSettled(chatDraftChanged, { scope: afterEdit, params: followUp.content });
    await allSettled(chatSendRequested, { scope: afterEdit });
    assert.equal(requests, 3);
    assert.equal(afterEdit.getState($chatRows).at(-1)?.text, `${roll}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('chat sends compact results and reads full traces on demand from this turn and from saved history', async () => {
  const originalFetch = globalThis.fetch;
  const presetId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const loadingTools = ['roll_dice', 'resolveCheck', 'getRollDetails'] as const;
  const rolled = { type: 'toolCall', id: 'pool', name: 'roll_dice', arguments: { rolls: { group: '100d1' } } };
  const detailed = { type: 'toolCall', id: 'direct', name: 'roll_dice', arguments: { rolls: ['d1'], details: true } };
  const checked = { type: 'toolCall', id: 'check', name: 'resolveCheck', arguments: {
    profile: 'standard', sides: 12, target: 1, mode: 'advantage', damage: { normal: 'd1 + 3' },
  } };
  const read = { type: 'toolCall', id: 'read', name: 'getRollDetails', arguments: { rollIds: ['check', 'missing', 'pool'] } };
  const callTools = (...parts: object[]) => new Response(sse({
    type: 'done', completion: { presetId, message: { role: 'assistant', parts }, finishReason: 'tool_calls' },
  }), { headers: sseHeaders });
  let requests = 0;
  let previousDetails: unknown;
  let checkFace: number;
  globalThis.fetch = withSavedChats(async (input, init) => {
    assert.equal(input, '/api/llm/generate');
    const { messages, tools } = JSON.parse(String(init?.body));
    assert.deepEqual(tools.map(({ name }: { name: string }) => name), loadingTools);
    assert.ok(tools.find(({ name }: { name: string }) => name === 'resolveCheck')?.parameters.properties.sides);
    switch (++requests) {
      case 1: return callTools(rolled, checked, detailed);
      case 2: {
        const [, , dice, check, direct] = messages;
        assert.deepEqual(dice.content, { rollId: 'pool', values: { group: 100 } });
        assert.equal(check.content.rollId, 'check');
        assert.equal(check.content.damage, 4);
        assert.equal(check.content.dice, undefined);
        assert.equal(check.content.check.margin, undefined);
        assert.deepEqual(direct.content.details[0].dice[0].results, [1]);
        checkFace = check.content.check.natural;
        return callTools(read);
      }
      case 3: {
        const { rolls } = messages.at(-1).content;
        assert.deepEqual(rolls.map(({ rollId }: { rollId: string }) => rollId), ['check', 'missing', 'pool']);
        assert.equal(rolls[0].result.check.natural, checkFace);
        assert.equal(rolls[0].result.rules.sides, 12);
        const pool = rolls[0].result.dice.details[0].dice[0];
        assert.equal(pool.sides, 12);
        assert.equal(pool.results.length, 2);
        assert.equal(rolls[1].error.code, 'not_found');
        assert.deepEqual(rolls[2].result.details[0].dice[0].results, Array(100).fill(1));
        previousDetails = rolls;
        return new Response(completed('Броски проверены.'), { headers: sseHeaders });
      }
      case 4: {
        const prior = messages[1].parts[0].text as string;
        assert.ok(prior.includes('getRollDetails'));
        assert.ok(prior.includes('returned {"rollId":"direct","values":[1]}'));
        assert.ok(!prior.includes('schemaVersion') && !prior.includes('observations'));
        return callTools(read);
      }
      case 5:
        assert.deepEqual(messages.at(-1).content.rolls, previousDetails);
        return new Response(completed('Подтверждено.'), { headers: sseHeaders });
      case 6:
        assert.equal(messages.length, 1);
        return callTools(read);
      case 7:
        assert.deepEqual(messages.at(-1).content.rolls.map(({ error }: { error: { code: string } }) => error.code),
          ['not_found', 'not_found', 'not_found']);
        return new Response(completed('В этом чате бросков нет.'), { headers: sseHeaders });
      default: throw new Error('Unexpected generation request');
    }
  });
  try {
    const scope = await openChat();
    for (const id of loadingTools) await allSettled(toolSettingChanged, { scope, params: { id, enabled: true } });
    await allSettled(chatDraftChanged, { scope, params: 'Брось и проверь результат.' });
    await allSettled(chatSendRequested, { scope });
    assert.equal(scope.getState($chatRows).at(-1)?.text, 'Броски проверены.');
    const reloaded = await openChat();
    await allSettled(chatDraftChanged, { scope: reloaded, params: 'Покажи прошлые броски.' });
    await allSettled(chatSendRequested, { scope: reloaded });
    assert.equal(reloaded.getState($chatRows).at(-1)?.text, 'Подтверждено.');
    await allSettled(chatCreateRequested, { scope: reloaded });
    await allSettled(chatDraftChanged, { scope: reloaded, params: 'Проверь историю другого чата.' });
    await allSettled(chatSendRequested, { scope: reloaded });
    assert.equal(reloaded.getState($chatRows).at(-1)?.text, 'В этом чате бросков нет.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
